# Steadier: store everything, surface what matters

**Recommendation:** build an attention home, not a chain of tiles. Open directly onto a small, explainable selection of next actions. Keep life areas as a stable directory, and keep the full inventory one click away. The master indicator should summarise the situation, not become a door the person must open before seeing useful work.

**Author:** Manus AI · 23 October 2026

## The underlying problem

The user is not primarily short of storage or organisation. They need to recover a useful picture of unfinished work, distinguish true commitments from background obligations, and begin a concrete action without first reviewing 200 jobs. A system that records everything but makes the user interpret everything has not solved this problem.

Success means answering “what needs attention, why, and what can I do now?” quickly. It also means returning after distraction with the previous next action intact. A visually quiet screen is not sufficient if it hides commitments, forgets undated work, or requires constant maintenance.

The five-second understanding test is a hypothesis to measure with real use, not a result we can claim from an attractive prototype.

## What existing products teach us

Todoist demonstrates a complete inventory with focused filtered views. It separates a planned work date from a fixed deadline, and supports a waiting convention through labels. Its flexibility is valuable for retrieval, but creating and maintaining queries can become another organisational job. [1] [2] [3]

Things demonstrates progressive visibility by time horizon: Today, Upcoming, Anytime and Someday perform different jobs. It also separates a start date from a deadline. This is useful evidence against displaying every active responsibility on the landing screen. The prototype should borrow those distinctions, not assume that all outstanding work is today's work. [4] [5]

Amazing Marvin explicitly separates importance from urgency and supplies dependencies that release work when prerequisites finish. It also offers mobile voice capture with review before keeping proposed tasks. These are valuable patterns, but its extensive configurability suggests a caution: capability should not require a user to configure a personal operating system before they can act. [6] [7] [8] [9]

The separate [existing-solutions review](existing-solutions.md) records the detailed strengths and gaps. The opportunity is not to claim that no existing app can do this. It is to make the useful combination understandable by default.

## Three materially different directions

### 1. Hierarchical tiles

A master object expands into area tiles, then task tiles and detail. This supplies familiar locations and can work well with five jobs. Its weakness is cross-area comparison: a count of twelve Home tasks does not say which one matters, whether it is blocked, or what to do first. With 50 or 500 jobs, users repeatedly drill into categories and return to compare candidates.

Clarity of organisation is high; clarity of immediate action is weaker. Initiation takes additional navigation. Accessibility needs careful semantic order and text labels rather than colour-only heat maps. Initial implementation is simple, but aggregated state and complex badges grow quickly. Keep it as a directory, not the front door.

### 2. A flat attention queue without tiles

One ordered list brings actionable work together across areas. Every row includes a next action and an explanation. This removes the category choice before starting and scales the working surface independently of inventory size.

It is fast and low-load when capped, but a 50-row queue is simply another overloaded list. A queue also risks becoming a black box when it reshuffles automatically. A stable hierarchy is useful for retrieval, and the user must be able to override recommendations. Implementation requires transparent rules, not necessarily AI.

### 3. Attention home plus task-resume view and area directory

The home shows at most five recommendations, led by one useful next action. A task-resume view keeps the next step, status and notes together. A quiet area directory and searchable All work view preserve orientation and trust. The summary makes hidden commitments explicit: for example, “8 commitments need attention; 3 are outside these suggestions.”

This is the best balance for five, fifty and five hundred jobs. The small working surface stays clear while search, state filters and review handle the inventory. It requires more careful state modelling than tiles, but avoids building a complicated spatial interface that still needs a cross-area queue.

The recommendation follows guidance to minimise irrelevant cognitive processing and help people recover their place after distraction. These principles support the direction; they do not prove a particular five-item limit or establish clinical outcomes. [10] [11] [12]

## The recommended behaviour

### Relevance is explained, not guessed

Separate a task's workflow state from its importance, deadline, availability and review date. A task can be important and undated, overdue and waiting, or ready but not relevant to today's context. Do not reduce these facts to one red/green health light.

The prototype uses deterministic rules. Completed and intentionally parked work do not compete for immediate starts. Future start dates and explicit deferrals suppress action suggestions until they return. Incomplete dependencies keep tasks blocked. Waiting items become follow-up candidates at their review date; this does not falsely mean the expected person has replied. Missing next actions become clarification candidates, not imaginary ready tasks.

Within eligible work, explicit pins and commitments come first, followed by due reviews and importance. Reserve one place for a due review or important undated responsibility when possible. Display every winning reason. Keep a separate commitment count and direct inspection route so a cap never conceals an excess of deadline risk.

Context and time filters help find a possible action, but a commitment summary must remain visible even when its work does not fit the current filter. A missed date is a fact with a recovery choice, not an accusation.

### Undated work has a review path

New active work gets a default review date seven days away, which is not presented as a deadline. Reviewing acknowledges the responsibility and chooses another review date; it does not mark the work complete. Someday is a conscious parking state with a browse path. This makes forgetting less likely without turning every obligation into an alarm.

No interface can guarantee that nothing is forgotten if it is never opened, the data is deleted, or reviews are consistently ignored. The app must expose its safeguards and limits rather than overpromise.

### Action beats organisation

Capture requires only a title. The user can add a concrete next action immediately or clarify it later. Start opens a focused view with the next action and an optional short timer. Complete, defer and mark waiting are direct actions. Notes, checklist items, dependencies and dates live in task detail instead of filling the overview.

A gentle “I'm drifting” control helps the user name the obstacle and choose a two-minute entry step, a pause, or a waiting state. It does not infer laziness, monitor other apps, or pretend to detect the user's mental state. A local focus checkpoint asks whether to continue or change the plan. This directly supports the user's stated refocus needs without escalating reminders into shame.

### Voice is part of the first version

Provide a persistent microphone for capture, an editable transcript before saving, and user-triggered read-aloud for the attention summary and next action. A limited spoken command path can propose completing or deferring the focused task, with an explicit confirmation instead of an accidental destructive voice action.

Browser speech recognition has limited availability and may send audio to the browser vendor's recognition service. It is not guaranteed offline or in embedded Android webviews. Read-aloud has wider browser availability, but device voices vary. Show meaningful errors and tell an unsupported user to open the app in a compatible full browser or use keyboard dictation; do not pretend the feature succeeded. [13] [14]

## The smallest useful prototype

Build a responsive web app with a local, versioned task store; a five-item attention surface; All work with search and filters; areas; review, waiting and blocked states; editable task detail; dependencies; recurring completion; quick capture; focus/resume; voice input/output; JSON backup and CSV interchange; and a protected demo lab.

This is a functional MVP prototype, not yet a complete cross-device personal system. A demo workspace starts with 200 realistic sample jobs. Personal work starts empty. Scenario controls replace only demo data. This prevents the exploratory tests from overwriting the user's future collection.

Natural-language capture should be honest: a small set of visible rules can interpret “tomorrow”, “Friday”, “15 minutes”, “important”, and area tags. Unsupported phrases remain editable text. Do not silently invent deadlines from vague language or label deterministic parsing as AI understanding.

The initial prototype does not connect Notion, Google Sheets, calendar or Telegram. Notion is available in the session, but the brief asks to explore possible sources, not to select or modify a personal database. No personal service data should be fetched without a selected source. CSV/JSON proves data-driven rendering without that dependency.

## Usability scenarios to demonstrate

**Five jobs:** the home should stay simple, all work remains discoverable, and no component should require a dense grid.

**Fifty, two hundred and five hundred jobs:** the suggested set stays capped, inventory is searchable and paginated, and totals reconcile. The count is a capacity cue rather than a completion target.

**Approaching and passed commitments:** reasons state when a commitment is due or passed. If more commitments exist than the suggested set can show, the additional number remains visible and links to all commitments. Context filters do not erase this warning.

**No deadlines:** important work and due reviews still surface. “Nothing time-critical” must not mean “nothing matters.” A review slot prevents perpetual deadline-only selection, although real-use fairness still needs measurement.

**Waiting and blocked work:** a waiting follow-up appears at its chosen review time; incomplete dependencies exclude a task from ready starts. Completing the last prerequisite makes dependent work eligible again without requiring manual tile construction.

**Interrupted work:** begin one task, leave the screen and return. The intended task and next action remain available. “I'm drifting” offers a small restart or an honest plan change rather than adding more guilt.

**Voice capture:** speak, inspect the transcript and fields, correct them, then save. Denied permissions, missing browser support and failed recognition should preserve existing data and explain the remedy.

These are prototype demonstrations and software checks. A real five-second comprehension test, screen-reader session and longer observation of forgotten responsibilities remain open.

## Technical architecture and data model

The first implementation is React and TypeScript in a static web build. A pure attention engine derives recommendations from task records; it does not store manually built UI tiles. Browser-local persistence and JSON/CSV export keep the data independent of a hosted task API. A service worker can cache the app shell after an online visit, and an application-owned manifest supports installation where the browser permits it. Service workers are event-driven and cannot guarantee exact background alarms. [15]

Each task has an ID, title, area, next action, notes, workflow state, importance, explicit pin, real deadline, start date, next review, defer-until date, duration estimate, context, waiting reason, dependency IDs, checklist, recurrence interval, creation/update timestamps and activity history. Dates used for responsibility planning are local calendar dates, not UTC midnight strings that silently shift days on an Australian phone. A focus session has a task ID, intended duration, remaining time and pause/resume state. Demo and personal workspace records have separate storage keys.

Recurrence in the prototype is an explicit number of days after completion, not a sophisticated calendar rule. Completing a recurring task records completion and creates the next occurrence with future availability; it should not create hundreds of missed instances. CSV is a flat interchange for core fields; JSON is the lossless backup for dependencies, checklist and history.

A full application should adopt IndexedDB for larger local collections and transactional updates, then add an authenticated synchronisation layer with per-user ownership, change versions and conflict handling only if real use establishes the need. A privately hosted service could use a small SQL database and deploy the same frontend. Static export can already be served from a VPS. Backend credentials must never enter browser code.

Do not implement unprotected public task storage. Reliable reminders require a deliberate background scheduling/push architecture and notification consent. Calendar and Notion adapters need a chosen source, mapping rules and conflict policy. These are product decisions, not hidden assumptions in the prototype.

## Questions for real use

Does a fixed cap of five feel manageable, and can the user understand what is omitted? Can someone distinguish “do this now” from “review this responsibility” without opening detail? Does a review reserve protect important undated work in a genuinely busy week, or should the system let the user choose a separate review moment?

Which explanations actually build trust? Does a changed queue help or disorient the user? Does voice capture produce concrete next actions or just a faster backlog? Does the drift flow help re-entry, or become another place to avoid the task? Which useful habit should it reinforce when the same responsibility is deferred repeatedly?

The right next step after this build is a short personal trial with a small real collection, then a controlled 200-task comprehension exercise. Improve the rules and capture flow before adding integrations, AI ranking or a more elaborate visual system.

## References

[1]: https://www.todoist.com/help/todoist/features/introduction-to-filters-V98wIH "Todoist filters"
[2]: https://www.todoist.com/help/todoist/features/introduction-to-deadlines-in-todoist-uMqbSLM6U "Todoist deadlines"
[3]: https://www.todoist.com/help/todoist/features/introduction-to-labels-dSo2eE "Todoist labels"
[4]: https://culturedcode.com/things/support/articles/4001304/ "Things time-based lists"
[5]: https://culturedcode.com/things/support/articles/2803579/ "Things scheduling"
[6]: https://help.amazingmarvin.com/amazing-marvin/importance-levels "Amazing Marvin importance"
[7]: https://help.amazingmarvin.com/amazing-marvin/urgency "Amazing Marvin urgency"
[8]: https://help.amazingmarvin.com/amazing-marvin/dependencies "Amazing Marvin dependencies"
[9]: https://help.amazingmarvin.com/amazing-marvin/voice-input-and-brain-dumps "Amazing Marvin voice capture"
[10]: https://www.nngroup.com/articles/minimize-cognitive-load/ "Nielsen Norman Group cognitive load"
[11]: https://www.w3.org/WAI/WCAG2/supplemental/patterns/o1p04-clear-steps/ "W3C Make Each Step Clear"
[12]: https://www.section508.gov/design/digital-content-users-with-cognitive-disabilities/ "GSA cognitive accessibility guidance"
[13]: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition "MDN speech recognition"
[14]: https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis "MDN speech synthesis"
[15]: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation "MDN offline and background operation"
