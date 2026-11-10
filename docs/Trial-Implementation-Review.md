# Trial implementation integration review

**Scope:** Static, read-only review of the requested trial paths: `useWorkspace`, storage/transfer, `BackupPanel`, and the Home, capture, editor, life, and today integrations. No source changes, test runs, browser use, or research were performed.

## Confirmed must-fix defects

1. **A valid legacy v1 record can be copied into a v2 key that will fail strict validation on the next load.**
   - **Locations:** `client/src/domain/transfer.ts:380-389, 579-608`; `client/src/hooks/useWorkspace.ts:175-183, 286-292`.
   - **Failure:** v1 validation deliberately accepts any non-empty `createdAt`, `updatedAt`, `completedAt`, and history timestamps. Migration then returns and writes a v2 workspace without re-validating it as v2. The subsequent v2 load requires valid timestamps and protects the just-written v2 record as corrupt. This affects legacy data that the old validator legitimately accepted, while the original v1 remains intact but the copy-forward path becomes unusable. The same issue lets a legacy backup preview as a candidate that `restoreBackup()` later rejects.
   - **Minimal correction:** Make `workspaceFromV1()` return a v2-strictly validated migration (or immediately pass its result through the v2 validator) before any candidate is exposed or v2 key is written. If strict conversion is impossible, keep only the original v1 bytes and enter protected/read-only recovery rather than writing an invalid v2 document.

2. **Restore preflight can retain or resurrect the wrong candidate after a malformed file or overlapping file reads.**
   - **Location:** `client/src/components/steadier/BackupPanel.tsx:173-192`.
   - **Failure:** Selecting a replacement file does not clear the existing `candidate`. If the new file is malformed/read fails, the previous valid candidate and its destructive “Replace” confirmation remain active despite the error claiming that the selected file changed nothing. Separately, `await file.text()` has no attempt/version guard: a slower first selection can finish after a later selection and overwrite the later preflight candidate/source.
   - **Minimal correction:** At the beginning of every selection, invalidate/clear `candidate` and allocate a monotonically increasing restore-attempt token. After `await file.text()` and in the error path, update candidate/message/error only when the token is still current. This keeps explicit confirmation bound to the most recently checked source file.

3. **An old focus-timer callback can write focus state into a newly selected workspace.**
   - **Locations:** `client/src/pages/Home.tsx:121-138`; `client/src/hooks/useWorkspace.ts:332-345, 422-447`.
   - **Failure:** `switchKind()` updates `kindRef` and `workspaceRef` synchronously, but the previous React effect’s interval is cleaned up only after the workspace change renders. If that callback runs in the gap, its captured old `focus` is passed to `saveFocus()`, which writes to `kindRef.current`—the new workspace. Usually strict task-ID validation rejects this, but matching IDs (for example restored/sample-derived records) let stale task/step/timer data contaminate the selected workspace.
   - **Minimal correction:** Bind timer writes to the workspace identity captured when the effect starts. For example, pass an expected kind/monotonic workspace generation to `saveFocus()` and have the hook reject it unless it still equals the current identity. Do not use the mutable current `kindRef` alone to route an asynchronous callback.

4. **Editing only part of a provisional identity can silently mark the whole label as user-confirmed.**
   - **Location:** `client/src/components/steadier/TaskEditor.tsx:54-60`.
   - **Failure:** A task with suggested role and pattern becomes `confirmed` whenever either selector changes and both fields happen to be non-null. For example, changing a suggested Support role to Direction leaves a suggested Timely pattern in place but records the composite Direction × Timely identity as confirmed, without the explicit “Use this identity” action.
   - **Minimal correction:** Preserve `labelSource: "suggested"` while editing a suggested identity; only set `confirmed` through the explicit confirmation action (or when both dimensions originated from direct manual choices). Clearing either dimension should remain unclassified.

5. **Restored matrix weights can pass validation but be silently ignored by the matrix and attention behavior.**
   - **Locations:** `client/src/domain/transfer.ts:511-520`; `client/src/domain/life.ts:151-159`; `client/src/components/steadier/LifeView.tsx:696-710`.
   - **Failure:** v2 validation accepts any finite value from 0 to 100, including decimals (the backup test uses `1.25` and `0.75`). The runtime helper and UI only honor integer weights 1–3, substituting neutral `1` for every other accepted value. A full restore therefore preserves the JSON field but not its actual emphasis behavior or visible selection.
   - **Minimal correction:** Establish one canonical persisted range. Given the current UI/runtime, validate only integers 1–3 in `validateMatrixWeights()` (and update fixtures); alternatively support the full validated numeric range consistently in both `matrixWeight()` and the matrix control.

## Focused conclusion

The full v2 backup shape, ID/dependency/project-link validation, bounded local recovery-copy format, no-cloud messaging, legacy-key non-removal, and explicit restore confirmation are otherwise aligned with the reviewed requirements. The five defects above should be corrected before treating the Preview as a safe personal trial, particularly the first three because they affect recoverability or workspace separation.

## Resolution — final trial version

All five confirmed defects above were corrected before handoff. Legacy migration now passes strict v2 validation before it can be written or offered for restore; unconvertible original bytes remain protected without an invalid new primary record. Restore selection clears the old candidate and uses monotonically increasing attempt tokens to reject stale file reads. Timer/focus writes carry the captured workspace generation, and full restore, undo and workspace switching invalidate old generations. Identity selector edits remain provisional until the explicit confirmation action. Persisted weights, UI and runtime all use integers 1–3.

Full-backup download/copy is also disabled for unreadable protected records, directing recovery to raw export instead of exporting a misleading empty/sample collection. Primary data-write success is separated from the preference-key write so a restored document is not written and then falsely reported cancelled because an unrelated preference write failed.

Evidence: TypeScript check, production static build and all 40 software tests passed. Eleven personal-trial browser checks passed, including exact full backup/restore, milestone/evidence, saved intention/focus, phone reflow and non-destructive valid-v1 migration. Five additional targeted browser safety regressions passed for valid-then-malformed selection, overlapping file reads, explicit identity confirmation, an old timer callback against a different workspace deliberately sharing task IDs, and protection of unconvertible v1 timestamps. The original 22 scenario/voice-lifecycle/offline checks passed earlier in this same update; after review only affected paths were rechecked.

All browser checks used fresh isolated stores and explicitly synthetic responsibilities. They did not read or mutate the user's browser data. Real microphone/Android vendor behavior, actual one-week experience, clinically meaningful focus improvement and guaranteed Preview availability remain outside this evidence.
