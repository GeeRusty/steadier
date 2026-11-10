# Text Backup Focused Review

**Scope:** Read-only source review of `BackupPanel`, `backupTransport`, Home wiring, and the shared/local restore guard. No browser, database, application edits, or test runs were performed.

## Findings

### 1. High — old backup text can render briefly in a new workspace scope

`BackupPanel` clears `shownBackup`, `pastedBackup`, `pasteOpen`, and `candidate` in a `useEffect` keyed by `scope` (lines 93–103). Effects run after the new render has committed. On a kind/shared/generation transition, the prior state therefore still satisfies the render conditions for that commit:

- `shownBackup !== null` renders the prior full JSON in the new scope (lines 386–435).
- `pasteOpen` renders the prior pasted JSON in the new scope (lines 438–500).
- An old candidate is rendered until the effect clears it (lines 503–548), although its confirm handler correctly rejects it by scope.

This is a privacy/owner-isolation gap, not an automatic replacement: `confirmRestore` checks `candidate.scope` before restoring, and the shared restore callback additionally captures and validates its account/transport generation. Still, the raw text can be visible in the wrong selected space for one commit.

**Minimal fix:** Scope-stamp display state and condition rendering on an exact current-scope match (including the candidate), then retain the existing cleanup effect for memory hygiene. For example, store `{ text, scope }` for shown/pasted text and render only when its scope equals `scope`; or remount `BackupPanel` with a stable key derived from this exact scope. A layout effect alone avoids a paint but still commits the sensitive DOM node, so a render-time scope guard is preferable.

### 2. Medium — legacy clipboard fallback puts raw backup JSON in an unmasked body child

When `navigator.clipboard.writeText()` is unavailable or denied, `legacyCopy()` appends a temporary textarea containing the complete backup to `document.body` (`client/src/domain/backupTransport.ts:62–97`). Unlike both visible backup textareas, that textarea has none of the existing privacy markers (`rr-block`/`rr-mask`, `data-private`, `data-hj-suppress`, `data-ms-mask`). Opacity does not prevent a DOM/session recorder from reading its value.

The bundled debug collector currently identifies itself as “no rrweb,” so this review does not claim that it presently exports textarea contents. The DOM handling nevertheless bypasses the privacy convention deliberately applied to this exact data elsewhere, and is most likely to execute on the constrained mobile/Preview path motivating this change.

**Minimal fix:** Before appending the legacy textarea, apply the same masking attributes/classes used by the visible private text fields (at minimum `className = "rr-mask"`, `data-private="true"`, `data-hj-suppress="true"`, and `data-ms-mask="true"`; use the recorder’s documented block marker if it differs). Preserve the existing immediate removal and no-clipboard-read behavior.

### 3. Medium — protected unreadable raw data retains the original download-only failure mode

For a read-only/corrupt workspace, the normal checked-backup paths are correctly disabled. But **Download raw saved data** directly calls `download()` without `try`/fallback (`BackupPanel.tsx:585–605`). If anchor/blob setup throws, the click exits without an in-panel error or manual text route. More importantly, as with regular downloads, a mobile browser can report a post-click save failure without throwing. This raw value may be the only recoverable representation of the unreadable source record.

**Minimal fix:** Keep raw data completely separate from a checked backup, but add a protected readonly **Show raw saved data** fallback (and/or show it when raw download setup throws). Label it as potentially invalid raw text; do not pass it through `exportBackup`, `parseBackup`, or the normal restore candidate flow. Apply the same privacy masking and scope clearing as full backup text. This retains the source without representing malformed data as a valid backup.

## Verified safeguards

- **Cancelled or invalid text restore does not replace data.** Opening/cancelling paste clears the candidate; `checkPastedBackup()` first clears it and only calls `beginRestore()` after synchronous `parseBackup()` succeeds. Parse failure leaves an error stating that nothing was replaced. The file route follows the same parse-before-candidate pattern.
- **Malformed raw saved bytes are not exported as a valid full backup.** `backupText()` rejects read-only storage; regular export calls `exportBackup()`, which validates via `validateWorkspace()` before serializing. The protected raw path is explicitly a `.txt` download and is not routed through the valid-backup parser/exporter.
- **Replacement has an independent confirmation and checked counts.** Pasted/file text is parsed and presented as a candidate before `confirmRestore()` calls any restore method.
- **Stale replacement is guarded.** The panel compares the candidate’s captured scope before restore. Shared replacement also captures transport generation and user ID, rechecks them after its server fetch, and returns false on stale/account-invalidated work; it therefore does not apply a stale request to another owner. Local restore is synchronous and stores a pre-restore recovery copy or preserves corrupt raw bytes before writing.
- **No automatic clipboard read/new text persistence was introduced.** The transport only writes on explicit action; the visible text fallback is component state/DOM, not a new storage record.

## Review conclusion

The normal checked text-backup/restore flow is validation-first and does not auto-restore on cancellation or malformed paste. Address findings 1 and 2 before relying on the fallback for private cross-device transfer. Finding 3 is a focused recovery-path gap for the pre-existing unreadable-data case; its fix must remain a distinctly labelled raw-text fallback, never a valid-backup export claim.

## Resolution and evidence

All three concrete findings were addressed before release. Sensitive export/paste/raw/candidate/feedback DOM is gated on the exact current scope at render time, then cleared in the cleanup effect; candidates also retain the before-restore scope check. The temporary clipboard textarea receives rr-block/rr-mask and the same private-data attributes before insertion. Unreadable saved data now has a separately labelled, read-only, masked raw-text display/select route and guarded download failure; it is never converted into a valid backup automatically.

The two backup fields now have explicit label/ID associations for populated textarea accessibility. TypeScript and production build passed. All 76 existing/new tests passed, including six transport tests with mask assertions. Sixteen targeted fresh-browser checks using synthetic stores and synthetic intercepted API replies passed: denied clipboard/manual selection, blocked download, unchanged originals, invalid/cancelled paste, exact confirmed identities/links, scope clearing, phone viewport, explicit help/stop, no shared write before confirmation, one guarded replacement, and Adelaide timezone on a first shared save. A separate synthetic malformed-store check preserved the original raw bytes exactly and confirmed the normal valid-backup controls remain disabled. No actual owner records were read or written by these checks. Native-phone copying and the user's actual migration still need the user's next step; do not infer them from desktop Chromium simulation.
