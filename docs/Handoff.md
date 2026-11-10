# Steadier: working prototype handoff

Open Manus Preview to try the application. It starts in a clearly labelled sample workspace with 200 responsibilities, of which at most five become explained attention recommendations. The tile hierarchy was deliberately replaced with an attention home, a focused next-step view and a browsable life-area directory.

The prototype includes task capture/editing, importance, dates, reviews, named waiting and blockers, dependency release, recurrence, completion/undo, search and paginated inventory. A focus session saves the chosen step and pause/resume state. “I'm drifting” offers a two-minute entry step, a break or an honest change of plan. Voice capture and read-aloud are first-version components; voice completion/deferral requires confirmation.

## A useful first trial

Begin with the sample workspace and change between 5, 50, 200 and 500 tasks under **Explore & data**. Try the deadline, passed-commitment, undated and quiet scenarios. Notice whether the first screen explains what matters, and whether you understand where the other tasks are held.

Then open **My personal space** and add just three real responsibilities. Give one a physical next step and try two minutes of focus. If you drift, use the restart control and record whether it helped. Avoid importing your whole backlog before checking whether the selection rules and review language feel trustworthy.

Use **Speak** to capture a task, inspect the transcript and save it. If the embedded Android app browser cannot expose speech recognition, publish the saved website version through the Dashboard and open it in a compatible full browser such as Chrome. A supported production browser can also install it through its app-install menu. Saving a checkpoint is not publication.

## Confirmed software evidence

TypeScript diagnostics/check passed. The production static build passed. All **22 automated unit/regression tests** passed, covering the domain rules and corrected state/storage edge cases.

All **22 targeted browser checks** passed. They cover the eight sample scenarios, five-item cap and inventory counts, personal/sample separation, capture/edit/search, paused focus and chosen-step recovery after reload, simulated read-aloud, simulated voice command confirmation and undo, simulated permission denial, unsupported-browser errors, waiting capture validation and corrupt-storage preservation. Phone widths of 390px and 320px had no horizontal page overflow, and there were no uncaught page errors in the exercised flows.

The actual production bundle reloaded offline after an online service-worker installation on a local test origin. This confirms the built offline shell, not that a public site has been published. Browser voice tests intentionally simulate API callbacks: they do not validate real speech accuracy, actual speaker output, Android permissions or vendor service availability.

The prior integration-review defects were corrected and covered by narrow regressions. Secondary text colours were darkened after measured contrast failures. This is not a full screen-reader, accessibility-conformance or real-user usability assessment.

## What is deliberately not claimed

No measured five-second comprehension result, no automatic identification of the user's mental state, no clinical benefit claim and no completed full cloud task platform. There is no guaranteed closed-app reminder, push, account login, automatic device sync or selected-source Notion/Sheets/calendar/Telegram integration.

Task data is per browser/device/website address. Preview and a published site do not share local storage. Browser storage can be cleared or evicted, so export JSON regularly. JSON is the lossless task backup; CSV is a core-field interchange. Import is additive, and importing twice adds another copy. No personal service data was read or modified.

## Deliverables and independent hosting

The product investigation contains the problem definition, review, three different design directions and comparison, recommendation, architecture/data model, MVP, scenarios and real-use questions. Supporting reviews, the implementation plan and usage instructions are included in the source package.

The package includes the source, pinned lockfile, tests, PWA assets and a ready-built static output under `dist/public`. Serve that directory over HTTPS on a normal static host or private VPS. The current app needs no database, private provider key or paid AI service. See `README.md` for reproducible commands and limitations.
