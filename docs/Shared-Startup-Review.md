# Shared Startup Review

## Confirmed findings

### High — published-site default silently falls into editable local/demo state when its initial session check fails

**Files/lines:**
- `client/src/domain/startupPreference.ts:135-138`
- `client/src/hooks/useSharedWorkspace.ts:1625-1647`
- `client/src/hooks/useWorkspace.ts:74-80`

For a canonical published-origin visit with no stored startup preference, the hook initially treats startup as a guarded shared-opening attempt (`useSharedWorkspace.ts:323-335`). However, if its initial session request fails (including a transient network failure), `chooseStartupPolicy` returns `browser` because there is no valid `sessionOwnerId` (`startupPreference.ts:135-138`). The catch path consequently clears `startupBlocked` (`useSharedWorkspace.ts:1625-1647`). A fresh local store defaults to `demo` (`useWorkspace.ts:74-80`), so the user is placed in an editable sample workspace instead of the required guarded sign-in/retry screen.

This violates the startup contract that a failed/missing shared-opening authentication must not fall into editable demo or other unverified data. It can make a failed published startup look like a usable application state and invite edits to the wrong collection.

**Minimal fix:** When the canonical published default has entered guarded shared startup and its session cannot be verified, keep the policy/action blocked (unless an explicit persisted `browser` or `demo` preference exists). Preserve `startupBlocked` and show the existing gate’s explicit browser/sample escape actions; do not clear the gate merely because `sessionOwnerId` is unavailable.

### High — automatic startup does not bind the discovery owner to the second session used for activation

**Files/lines:**
- `client/src/hooks/useSharedWorkspace.ts:1542-1562`
- `client/src/hooks/useSharedWorkspace.ts:872-899`
- `client/src/hooks/useSharedWorkspace.ts:937-968`

Automatic discovery validates the stored shared preference against the first session response and then invokes `connect()` without passing that validated owner (`useSharedWorkspace.ts:1542-1562`). `connect()` makes a second session request, but never compares its `user.id` with the owner that authorized the automatic route (`useSharedWorkspace.ts:872-899`). If the account changes between the two session responses, it fetches and activates the second account’s workspace, then overwrites the remembered shared-owner preference with that second ID (`useSharedWorkspace.ts:937-968`).

The server still authorizes the second account, but this violates the required fresh *same-owner* check for automatic activation and turns an account-transition race into an unprompted change of the selected shared personal space. The already-added initial wrong-owner branch does not cover this sequence because the first session did match the stored owner.

**Minimal fix:** Have automatic discovery call `connect` with the owner ID it just validated (including the published-default user ID). After `connect` obtains its fresh session and before any workspace/cache read or preference write, require the returned ID to match that expected owner. On mismatch, keep the startup gate blocked and preserve the stored preference; only a subsequent explicit gate retry may connect to the newly signed-in account.

## Review limit

The latest explicit `policy.action === "blocked"` branch correctly addresses the parent-reported initial wrong-owner route and is not reported here as unresolved. No other confirmed significant defect was found in the inspected stale-transport cancellation after explicit browser/demo choices, startup-effect stability, valid consent-path shared activation/write suppression, or focus ticking while the startup gate is active. This was a static read-only review; existing checks and the parent’s synthetic/browser/full-suite work were not repeated.

## Resolution before release

Both reviewed findings were fixed narrowly. Canonical published startup without a verified session now returns a blocked policy unless the user explicitly selected browser/demo. Automatic discovery passes its verified owner to `connect(expectedOwnerId)`; the second session must match before any workspace/cache read or preference update, otherwise existing account invalidation preserves all saved bytes and requires deliberate reconnect. The separately discovered wrong-owner success-policy fall-through was also corrected with an explicit blocked branch.

Final evidence: TypeScript and production build passed; 82 existing/new tests passed, including six startup-policy tests. Thirty-one targeted synthetic browser checks passed for Preview separation, shared reload/new tab, browser/demo persistence, original-byte preservation, no mode-change uploads/focus claims, wrong/mid-startup-changing owner, expired login, unavailable server, published defaults, phone gate layout, explicit voice/stop and consent-page activation/write suppression. All private API calls in these UI checks were intercepted; no real owner records were accessed or changed. Native user startup and the still-pending actual backup migration remain separate user steps. Public deployment confirmation is tracked separately from these software checks.
