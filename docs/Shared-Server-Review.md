# Shared-server integration review

**Scope and method.** Read-only static integration review of the completed shared-server upgrade on 24 October 2026. I traced the declared requirements through the Express routes/service/repository/projections, Manus session and cookie path, client cache/sync hook, cloud UI, backup/restore flow, focus UI, sheet/CSV projection, schema, and migration metadata. No source code, database, browser, or runtime test operations were performed in this review.

## Priority findings — fix before treating shared sync as safe

### P0 — A successful PUT can acknowledge the wrong revision and silently rebase a newer local edit over another device

**Affected paths:** `server/steadier/service.ts:100-142`; `client/src/hooks/useSharedWorkspace.ts:450-522`; `client/src/domain/cloudSync.ts:320-343`.

`saveWorkspace()` correctly CAS-writes `candidate` at `current.revision + 1`, but then performs a separate `repository.readWorkspace()` and returns whatever is current at that later instant (`service.ts:138-142`). Another device can successfully CAS from that just-committed revision before the first request's reread. The first caller then receives the *other device's* record as the 200 acknowledgement.

The dangerous case is an edit queued locally while the first PUT was in flight:

1. Client A sends snapshot A1 with base revision 5; it has already queued later snapshot A2.
2. A1 CAS-commits revision 6.
3. Client B reads revision 6 and CAS-commits a different document at revision 7 before A's post-write `readWorkspace()`.
4. A's 200 response incorrectly contains B's revision-7 document. `acknowledgeCloudWrite()` treats any 200 record as the acknowledgement of A1 and assigns A2 `baseRevision: 7` (`cloudSync.ts:333-341`).
5. `flushCloud()` immediately sends A2 at base 7 (`useSharedWorkspace.ts:516-518`), overwriting B's document without the intended visible conflict.

This bypasses the intended complete-document conflict protection despite each individual database update being CAS-protected.

**Minimal correction:** Return the exact committed candidate from `saveWorkspace()` after a successful insert/update rather than rereading the row. Convert its `updatedAt` to the wire ISO string and return revision `base + 1`, workspace, timezone, and focus owner that were committed. Keep the reread only for a CAS miss/conflict response. Add a deterministic test with two writes interleaved between the first update and acknowledgement read; a later queued local edit must conflict with the intervening remote document, not rebase over it.

### P0 — Session/account changes in another tab can mix one account's cache and pending document with another account's server workspace

**Affected paths:** `client/src/hooks/useSharedWorkspace.ts:294-303`, `450-525`, `636-698`, `700-722`.

The active cloud runtime binds `runtime.user.id` and the cache key only when `connect()` or mount-time `checkSession()` runs. Later `refreshServer()`, `flushCloud()`, conflict choices, restore, and transfer use the current browser cookie through `privateRequest()`, but do not re-check which Manus user that cookie now authenticates. `currentTransport()` only compares the captured generation against the in-memory, previously observed user ID; it cannot establish that the cookie still represents that user.

This is a concrete cross-account path in a shared browser profile:

1. Tab A connects as account A and has cache/pending data under `steadier.cloud.v1.user.<A>`.
2. Another tab signs the same origin in as account B, replacing the shared session cookie.
3. Tab A's 15-second/visibility refresh accepts B's `/workspace` response into A's cache (`refreshServer()`), because no session identity is checked.
4. More seriously, Tab A can flush its pending A document using B's cookie (`flushCloud()`), thereby writing A's private data into B's server workspace. The UI still labels the runtime as account A.

This violates the requirement that requests/callbacks are bound to account generation and can leak data across account boundaries even though the server correctly owner-scopes every individual request.

**Minimal correction:** Bind every authenticated cloud operation to a freshly verified session identity, not only to the historical runtime identity. A simple safe approach is to call `/api/steadier/session` before accepting a workspace response or sending a mutation, compare the returned ID to `runtime.user.id/cache.userId`, and on mismatch invalidate the transport generation, stop the write, leave the old owner cache untouched, and require a deliberate reconnect under the new account. Better, include the authenticated `userId` in each owner-scoped workspace response and validate it against the cache before adoption; still guard a write with a session recheck immediately before it is sent. Add a two-tab/account-switch synthetic test with a pending document.

### P1 — Server focus ownership permits a foreign client to stop or erase another device's running focus

**Affected paths:** `server/steadier/service.ts:79-94`.

`focusOwnerForWrite()` returns `null` immediately if the submitted focus is absent or not running (`lines 80-81`). The foreign-owner comparison only occurs after that return and only when the submitted focus remains running (`lines 84-90`). Therefore a client with the current server revision but a different `clientId` can PUT a valid workspace in which the running focus is `null` or paused, clearing both the focus and its ownership without `claimFocus` or a `FOCUS_OWNERSHIP` conflict.

The normal UI blocks this specific mutation, but the server is the authority and the protected API accepts it. This is incompatible with focus ownership as server metadata and allows a second device/tab to silently stop the owner device's session.

**Minimal correction:** When the current workspace has a running focus owned by another client, compare current and submitted focus *before* the `!nextFocus || !nextFocus.running` return. Reject any focus change (including stop/end/pause/task change) unless the caller is the owner or the request takes ownership through the explicit claim path. Preserve the existing allowance for non-focus document edits that leave the focus structurally unchanged. Add server-route tests for foreign `focus: null` and `focus.running: false` writes.

### P1 — The client can silently take foreign focus through ordinary Start, and falsely reports failed foreign-focus task mutations as successful

**Affected paths:** `client/src/hooks/useSharedWorkspace.ts:908-950`; `client/src/pages/Home.tsx:166-241`; `client/src/components/steadier/FocusDialog.tsx:93-214`.

There is an explicit “Take focus on this device” affordance for a displayed remote focus. However, selecting **Start** on a different ready task calls `saveFocus()` (`Home.tsx:226-241`). In `saveFocus()`, a new running task is treated as `startsOrResumes` and therefore bypasses the remote-owner rejection and sends `claimFocus: true` (`useSharedWorkspace.ts:927-947`). It takes ownership without the dedicated confirmation/control.

Separately, the UI's normal remote-focus protections can reject completion or deferral: `mutate()` detects a foreign owner and returns `false` when the mutation changes focus (`useSharedWorkspace.ts:850-861`). `done()` and `defer()` ignore that result, close the focus/editor, and show success text anyway (`Home.tsx:166-224`). For example, pressing “Finished this responsibility” in `FocusDialog` while another device owns the running session can result in no server/local change but the toast “One responsibility moved forward.” The dialog also leaves pause/end controls enabled while remote; rejection is only surfaced after an attempted action.

**Minimal correction:** Require an explicit takeover confirmation before any remote-focus change, including starting another task; do not infer it from a normal Start action. Have `done()`, `defer()`, and other mutation callers honor the boolean return before closing UI or showing success. Disable or replace remote focus-changing controls with the takeover action until acknowledged. This also makes current status reporting honest.

### P1 — A malformed, unrelated original browser workspace makes a healthy shared server collection permanently read-only

**Affected paths:** `client/src/hooks/useSharedWorkspace.ts:198-230`, `331-338`, `1152-1212`.

`readOriginalPersonal()` intentionally marks malformed original local v1/v2 bytes as `protected`, which is correct for preserving those bytes. But `sharedReadOnly` then includes `originalPersonal.protected` and `local.readOnly` (`lines 331-338`). Once shared mode is active, all cloud edits, server restore, conflict choices, and initial transfer are blocked—even if the owner-scoped cache and server workspace are valid. The original browser data is never used as the cloud cache (`lines 247-251`), so its unreadability is unrelated to the integrity of the checked cloud document.

A user who has an old corrupt personal localStorage key and then signs into a healthy server collection can view but cannot use the shared workspace until they resolve the unrelated old browser record. This defeats the intended preservation/isolation of original browser records and makes server recovery impracticable in precisely the corruption case.

**Minimal correction:** Keep original-local corruption visible and prohibit transfer from it, but do not include it in shared-mode write gating. `sharedReadOnly` should depend on cloud cache/write safety (cache persistence failure, loading/conflict/error as appropriate), not local original-store readability. Retain the protected raw-export/recovery route while disconnected or expose it as a separate recovery control.

## Confirmed implementation safeguards

These are code-traced properties, not a claim of live deployment or phone-provider validation.

- **Authentication and owner isolation:** Every `/api/steadier/*` workspace, recovery, sheet, and key route calls `requireSignedInUser()` before using the authenticated numeric owner ID. Repository reads/updates/listing are owner-scoped (`server/steadier/routes.ts:163-235`; `repository.ts:92-110, 148-199, 201-250`). Cron identities are rejected as owner identities.
- **Cross-site cookie/CSRF design:** Sessions use `HttpOnly; Secure; SameSite=None` (`server/_core/cookies.ts:3-6`) for the stated cross-site Preview environment. Mutations require `X-Steadier-Request: 1` plus JSON content type (`routes.ts:91-99`); the browser client supplies them with included credentials (`client/src/lib/cloudApi.ts:1-18`). OAuth state is bound to an expiring `__Host-` nonce cookie (`client/src/const.ts:15-31`; `server/_core/oauth.ts:23-32`). This is static implementation evidence; cross-site browser behavior was not exercised.
- **Compass capability scope:** Compass endpoints are GET-only and authenticate only a strict Bearer capability, never a session (`routes.ts:239-260`). Tokens are 32-byte random values stored only as SHA-256 hashes; expired/revoked values are rejected (`service.ts:145-207`). `touchCompassKey()` updates intended last-used metadata; it is not a workspace/data write. No query-string credential route exists. The plaintext token is returned only upon creation and the UI clears/reveals it only in the owner session (`SharedDataPanel.tsx:542-580`).
- **Cache and pending-edit treatment:** Browser cloud cache is owner-keyed and validates `userId`; pending documents are full snapshots, not patches (`cloudSync.ts:12-39, 192-235`). Transport uncertainty is reconciled only on an exact server-document match; otherwise it becomes a visible conflict (`cloudSync.ts:400-430`). The P0 acknowledgement race above is the material exception.
- **Initial transfer and original records:** Connection and mount discovery do not fetch/upload local responsibilities. Transfer rereads the server and only proceeds with a checked empty collection; original local keys are read only and never deleted (`useSharedWorkspace.ts:1152-1212`; `SharedDataPanel.tsx:274-335`).
- **CAS and replacement recovery:** Workspace update uses a conditional owner+revision update inside a transaction, and snapshots the prior server document in the same transaction for an explicit replacement (`repository.ts:148-199`). Insert collision is converted to conflict. The P0 issue is acknowledgement selection after a successful CAS, not the conditional write itself.
- **No-store/private responses and sheet completeness:** `/api/steadier` and `/api/compass` are `private, no-store` (`routes.ts:37-40, 159-160`). Compass context includes the complete workspace plus derived availability and freshness (`projections.ts:131-145`); CSV iterates every task and standalone project, and keeps deadline separate from preparation date/source (`projections.ts:240-318`). CSV formula escaping is present (`projections.ts:147-155`).
- **Migration:** `drizzle/0001_aromatic_katie_power.sql` creates only the three new shared tables/indexes and is recorded in `drizzle/meta/_journal.json`. Per the assignment, actual migration application/persisted database state was not queried.

## Status/UI honesty after the findings above

Most status copy is appropriately conservative: it distinguishes last confirmed server update from pending browser edits and tells users Compass cannot see unconfirmed work (`SharedDataPanel.tsx:178-188`, `SheetView.tsx:63-75`, `Home.tsx:417-439`). Cloud backup restore is asynchronous and `BackupPanel` awaits the cloud restore result rather than reporting synchronous local success (`BackupPanel.tsx:133-156`; `useSharedWorkspace.ts:991-1051`). The P1 focus-success reporting defect is the confirmed exception.

## Evidence boundary and remaining validation

The supplied static tests cover three server-route scenarios and eight pure cloud-sync scenarios (`server/steadier/routes.test.ts`, `client/src/domain/cloudSync.test.ts`); they do not cover the P0 interleaving, account-switch cache boundary, foreign stop-focus request, or remote-focus UI outcomes described above. I did not rerun them.

Implementation contains Manus project-JWT session, OAuth callback, cookie, CSV/JSON Compass capability, and server-sheet paths. This review does **not** supply actual phone login, OAuth-provider/session usability, cross-site cookie behavior, deployed publication, managed-MySQL persistence, or Compass-client connection evidence. The UI accurately says a capability is supplied rather than claiming an unspecified Compass client is configured. Absence of Google Sheets/MCP integration is not a defect in this requested CSV+JSON server-sheet design.

## Resolution before server release

The findings above are retained as the historical review, not unresolved defects. The post-CAS acknowledgement now returns the exact committed document/revision; a deterministic interleaving regression covers the queued-edit race. Every private application request except session discovery is atomically bound to an `X-Steadier-Owner` expected identity checked against the real authenticated session; cookie changes block requests instead of mixing caches. Expired/changed account access invalidates client transport and preserves the old owner's pending bytes for deliberate reconnection.

Server focus guarding now covers foreign pause/end/null as well as running changes. The client exposes actual acknowledged remote ownership, prohibits implicit takeover, and ticks only after ownership acknowledgement. The dedicated handover action is explicit; remote focus-changing controls are disabled. Completion, deferral, editor save and capture check mutation acceptance, retaining unsuccessful drafts rather than showing success. Unrelated original-browser corruption no longer blocks valid shared data or server recovery. Initial writes choose the real browser timezone rather than the empty UTC placeholder.

The parent additionally guarded task and outcome edit drafts against incoming refreshes. A stale full-object draft cannot erase another device's task fields or outcome evidence; it remains open with an explicit private draft download before reopening the current record. These are not full-workspace backup files.

Confirmed evidence at this update: TypeScript and production frontend/server builds passed; the full software suite passed 56 tests; 11 synthetic authenticated server/device checks passed; 3 further conflict/key-UI/offline flows passed; account-cookie swap and corrupt-original isolation checks passed; both open-draft guards passed separately; and the existing 22 local capture/voice/focus/offline regression checks passed. The final remote-focus UI continuation and publication are recorded in the release handoff once complete. Actual Android microphone, real user OAuth interaction and actual Compass-client configuration remain separate user/provider checks. No real owner records were imported for these tests; secrets and synthetic downloads stay in ignored `.webdev/` storage.

Final continuation: the deliberate acknowledged remote-focus UI handover/pause check passed. All 19 synthetic server-related checks are complete. Publication remains distinct from these local and database checks.
