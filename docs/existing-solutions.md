# Existing task-app patterns for an exploratory personal attention dashboard

**Author:** Manus AI

A dashboard holding roughly 200 responsibilities should act as an **attention layer**, not a shorter master list. Across the three products, the useful common idea is to keep a complete system of record while deliberately showing work only when it is actionable or relevant. The products differ in whether that relevance is constructed with filters, time horizons, or an explicit task-state engine.

## Todoist: flexible query views over a large task store

Todoist’s primary pattern is a large task store with saved, custom **filters**. A filter can combine task name, date, project, label, priority, creation date, and other criteria, then be saved and favorited. This is a useful precedent for keeping 200 responsibilities without using the full list as the daily surface. [1]

Its strongest distinction for this concept is between a **date**—when the user plans to work—and a **deadline**—a fixed finish-by cutoff. Deadline and no-deadline queries can then support separate attention surfaces. [2] Labels provide an intentionally flexible way to model states; Todoist itself suggests a `waiting` label for tasks awaiting input or information. [3]

The limitation is that Todoist’s standard priority field blends the two signals this dashboard should separate: its P1 is described as both “most important” and “urgent.” [4] Its waiting convention is a label, rather than a visible state with follow-up behavior, and the reviewed official material describes filtering and labels rather than automatic prerequisite release. Treat its filter model as an inspection and retrieval pattern, not as the core state model.

On iPhone, Todoist supports Siri dictation. Supported Siri AI requests can populate a task’s description, date/time, priority, labels, and location trigger in one sentence, but the capability is **iOS-only** and depends on device, OS, language, and Siri availability. [5] This is useful voice-capture evidence, but it is not a self-contained, cross-device mandatory-voice interaction.

## Things: progressive disclosure by time horizon

Things offers the clearest progressive-disclosure pattern. **Today** is intended to contain only work the user will do today; **Upcoming** holds future-planned work; **Anytime** holds active, actionable work; and **Someday** keeps vague or deferred work out of active lists. Future-start tasks and projects hibernate in Upcoming until their start date, while Someday items do not appear in active lists. [6]

That gives the dashboard a valuable rule: neither a large archive nor an active-but-not-current list belongs in the default phone view. Things also separates the start date from the hard deadline: a start date says when to begin, while a deadline says when work must finish. Deadline tasks remain active in Anytime, and a chronological Deadlines list is available when needed. [7] Task details such as tags, checklist, start date, and deadline are available without making every row visually dense. [8]

The missing pieces for this brief are a distinct waiting state and automated dependency release; the reviewed default-list and scheduling documentation instead centers on time-based visibility. Its voice route is Siri on Apple devices. The official guidance notes that Siri understands a start date but not a Things deadline, and Siri AI availability is conditional. [9] A new phone-first dashboard should therefore not rely on an OS assistant as the only voice path.

## Amazing Marvin: explicit attention and availability controls

Amazing Marvin is the closest reference for modeling attention signals independently. Its **Urgency** strategy marks work that needs attention soon even without a hard deadline. Its **Importance Levels** strategy is explicitly framed as long-term value rather than time sensitivity; the documentation recommends using the two together and filtering a 50-task day down to the 3–5 items that matter. [10] [11]

It also has a real dependency behavior rather than a tag convention: adding a dependency sends an item to **Backburner**, identifies why it is there, and moves it back to the Master List with a “new” marker when prerequisites are complete. [12] Smart Lists can derive focused views from multiple criteria, including all-of combinations, and unwanted prebuilt lists can be hidden on mobile. [13]

For mandatory voice, Marvin supplies the most relevant capture behavior: mobile voice input is on by default; spoken multi-add supports a configurable separator; and a spoken brain dump is split into tasks and shown for review before keeping or discarding it. [14] Its Super Focus surface can show one task at a time. [15]

The trade-off is configuration burden. Marvin presents more than 100 features and 300-plus customizable settings, many enabled or disabled by the user. [15] That is a useful capability library, but not a good default interaction model for an exploratory dashboard: the user should not have to configure the system before it protects attention.

## Design path

Use the three patterns together, without copying any one app.

1. **Make task state first-class, not a label convention.** A responsibility should be captured once and then be in one clear state: `inbox`, `ready`, `scheduled`, `waiting`, `blocked`, `someday`, or `done`. A waiting item needs “waiting for” plus an optional follow-up date. A blocked item needs one or more prerequisites and must leave the ready queue until they are complete. Completing the last prerequisite should release it and briefly mark it as newly available, following Marvin’s availability pattern. [12]

2. **Keep four independent attention signals.** Store **importance**, **urgency**, **hard deadline**, and **start/review date** separately. Hard deadlines are externally consequential finish-by dates; start dates make work relevant; urgency expresses rising attention without inventing a date; importance expresses value. This preserves the useful Todoist and Things date/deadline separation while avoiding Todoist’s single-field urgency/importance conflation. [2] [4] [7] [10] [11]

3. **Default to a small, explainable phone surface.** The home screen should show a “Now” set of three to five ready tasks, then a collapsed “Next” set, then small counters for waiting, blocked, and upcoming deadlines. A tap should progressively disclose why an item is here, its project, deadline, dependency, notes, and the larger list. A separate Library is where all 200 responsibilities remain searchable and browsable. Do not make the Library, an undifferentiated Today list, or settings the landing screen. The number is a capacity guardrail, not a claim that the rest is unimportant.

4. **Let the dashboard recommend relevance, but show the reason.** “Now” should favor a hard deadline, high urgency, high importance, and availability; it must exclude blocked items. Each recommendation should carry a plain-language reason such as “deadline tomorrow,” “important and no scheduled next action,” or “unblocked today.” This borrows the useful focus outcome of Things and Marvin while avoiding a hidden ranking system. [6] [11] [15]

5. **Make voice a mandatory capture path, not an integration.** Put a persistent microphone on the primary phone screen. One utterance such as “Ask Maya for the lease update, waiting, follow up Friday” should create a proposed task and expose editable chips for person, state, and follow-up before confirmation. For a longer brain dump, split proposed tasks and require a quick review, as Marvin does. [14] Typed entry can remain as a fallback, but every core operation—capture, complete, defer, mark waiting, and unblock—needs an equally direct phone interaction.

This path keeps the calm time-horizon behavior of Things, the inspectable saved-view idea of Todoist, and Marvin’s explicit attention and dependency mechanics. It deliberately avoids filter syntax, deep setup, and assistant-dependent voice capture as requirements for ordinary use.

## References

[1]: https://www.todoist.com/help/todoist/features/introduction-to-filters-V98wIH "Todoist introduction to filters"
[2]: https://www.todoist.com/help/todoist/features/introduction-to-deadlines-in-todoist-uMqbSLM6U "Todoist introduction to deadlines"
[3]: https://www.todoist.com/help/todoist/features/introduction-to-labels-dSo2eE "Todoist introduction to labels"
[4]: https://www.todoist.com/help/todoist/features/set-a-priority-in-todoist-Wy82Jp "Todoist set a priority"
[5]: https://www.todoist.com/help/todoist/features/use-siri-with-todoist-zDdrA4 "Todoist Siri support"
[6]: https://culturedcode.com/things/support/articles/4001304/ "Things time-based lists"
[7]: https://culturedcode.com/things/support/articles/2803579/ "Things scheduling to-dos"
[8]: https://culturedcode.com/things/features/ "Things feature overview"
[9]: https://culturedcode.com/things/support/articles/2877019/ "Things speaking to Siri"
[10]: https://help.amazingmarvin.com/amazing-marvin/urgency "Amazing Marvin urgency"
[11]: https://help.amazingmarvin.com/amazing-marvin/importance-levels "Amazing Marvin importance levels"
[12]: https://help.amazingmarvin.com/amazing-marvin/dependencies "Amazing Marvin dependencies"
[13]: https://help.amazingmarvin.com/amazing-marvin/smart-lists "Amazing Marvin smart lists"
[14]: https://help.amazingmarvin.com/amazing-marvin/voice-input-and-brain-dumps "Amazing Marvin voice input and brain dumps"
[15]: https://amazingmarvin.com/ "Amazing Marvin product overview"
