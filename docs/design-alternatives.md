# Design alternatives for a personal outstanding-work dashboard

**Recommendation: make the landing view an attention home, not a hierarchy browser.** Use a hybrid model: a short, explainable attention queue for choosing or resuming work; a calm area directory for orienting and browsing; and a task-resume view that keeps the next action and context visible. Retain every task in the inventory, but do not ask the person to interpret the entire inventory before beginning.

The proposed sequence — master tile → area → task → details — is a useful **storage and browsing structure**. It is weak as the default working structure because it makes a person choose a category before they can see the best next action. That extra decision is especially costly when they are interrupted, uncertain, or already overloaded. Interface cognitive load consumes limited mental resources; clutter, needless decisions, and forcing recall can slow people down or lead them to abandon the task. Good interfaces therefore remove irrelevant processing and re-display the information needed for the decision at hand. [4] The dashboard should use hierarchy for retrieval, not require hierarchy to initiate work.

## The working principles

Show **a few relevant items, not a summary of all obligations**. “Relevant” must be explainable in plain language: an external commitment is near; this is the unfinished item being resumed; this is unblocked and fits the selected context; this project has not been reviewed; or the user explicitly pinned it. Do not create a mysterious universal priority score. A recommendation that cannot explain itself becomes another judgment the person must distrust or decode.

Treat urgency, actionability, and workflow state as different facts. A task can be urgent but impossible to act on, or not urgent but ideal to start now. Use separate, visible labels such as **due today**, **no date—review this week**, **ready**, **needs a decision**, **blocked by Sam**, and **waiting for reply**. “Blocked” and “waiting” should name the missing condition and offer the next sensible follow-up when one exists. “Due soon” is a commitment signal, not a moral verdict; never turn an elapsed date into a shaming red “overdue” identity.

Make the task view a **restart point**. It should always reveal: the outcome or purpose, the next physical action, the current status, the relevant person or dependency, and a short trail of the last meaningful update. This lets a returning user answer “what was I doing and what do I do now?” without opening several levels. W3C’s cognitive-accessibility guidance specifically recommends showing current location, completed and pending steps, and important choices so a person can continue after distraction without rereading or restarting. [2]

“Deadline-free tasks never forgotten” cannot honestly mean that every undated item is always visible. It means each retained item has a future **review path**. On capture, ask for the smallest useful commitment: a next action, an area, and either a review cadence or an intentional parking state. An undated but active item reappears at its review time; a task with no next action appears as **clarify** rather than silently decaying; a waiting item reappears for a chosen follow-up; an intentionally deferred item stays discoverable in its area and can return through a periodic review. This is an attention safeguard, not fake urgency.

## Model 1: hierarchical tiles as the primary interface

This is the literal interpretation: a master tile gives area tiles, an area gives task tiles, and a task opens a detail view. Its strength is a stable spatial map. At **5 tasks**, it is clear and pleasant if the areas are few, familiar, and each tile exposes a count plus one meaningful state. It can feel fast for someone who already knows the correct area. Its cognitive cost is moderate: the user must first recall where a task belongs, then decide whether that area is worth opening.

At **50 tasks**, the master tile and area counts quickly become dashboards about volume rather than action. A number such as “12 in Home” does not say whether any item is ready, blocked, waiting, or needing a decision. The user must drill in repeatedly to compare candidates across areas. That is slow at the moment initiation is hardest, and it turns the hierarchy into a memory test.

At **500 tasks**, tile navigation is a directory, not an attention system. It can still scale as a browsable archive with search, filters, and saved views, but it will obscure cross-area deadlines, neglected undated work, and dependencies. Adding badges, heat maps, or several counters to solve this tends to make each tile visually noisy while leaving the main question unanswered: “What can I do now?”

Accessibility is feasible but easy to get wrong. A grid can have a confusing keyboard order, a density that fails at zoom, and status communicated only by color or tiny badges. Use semantic headings and lists, buttons with meaningful names, text labels in addition to color, responsive reflow, and stable locations. W3C advises clear purpose and familiar, consistent controls; GSA advises manageable sections, descriptive labels, readable type, contrast, and avoidance of overcrowding. [1] [3] Implementation is comparatively simple for a small collection: area and task records with counts and filters. It becomes more complex at scale because every tile needs aggregated state logic and because a user still needs another cross-area view to work effectively.

**Verdict:** keep this as the **area directory**, not the landing experience. It is good for orientation and retrieval, but poor at prioritization and refocus.

## Model 2: flat attention queue

This model discards tiles from the working surface. The home page is one ordered queue with a small **Now** section, a short **Next** section, and deliberate views for **ready**, **waiting**, **blocked**, **clarify**, and **review**. An item shows title, area as secondary context, its next action, and plain-language reasons for appearing. The person can start the first item, choose another suggested item, pin one, snooze one, or open the full queue.

At **5 tasks**, this is exceptionally clear and fast. The first screen can say “continue the budget draft” followed by two alternatives, which reduces the need to organize before acting. The risk is that it can feel overly prescriptive if its ordering changes without explanation. The remedy is user control: allow drag or pinning and visibly state why an item is here.

At **50 tasks**, a well-designed queue remains the fastest model for task initiation, because it compares action candidates across areas in one place. Its cognitive load is low only if the visible queue is capped. A 50-row list is merely a different form of overload. The full inventory must remain available through search and filters, while the home queue keeps a strict, calm limit such as one resume item, one recommended start, and up to three alternatives.

At **500 tasks**, the queue can still work, but only with disciplined state data and a reliable review process. Ranking must consider explicit commitments, next-action existence, dependency state, area/activity context, user pins, and neglected-review signals. Do not calculate importance from age alone: old work may be intentionally dormant. The main failure mode is a black box that continuously reshuffles work, causing loss of trust and poor reorientation.

Accessibility is naturally strong when it is a semantic, keyboard-operable list with logical headings and no reliance on a spatial grid. It should not dynamically move an item under a focused cursor, and status must be written rather than indicated only by color, icon, or position. Give the user a low-density option, reduced motion, predictable sorting, and an announcement only when a user-triggered change occurs. Implementation is more involved than tiles because it requires transparent selection rules, stable sort behavior, and review scheduling. Yet the data model is straightforward: tasks hold independent commitment, action, workflow, and review fields; a queue service chooses and explains a small subset.

**Verdict:** strongest for immediate action and low cognitive load, but too narrow as the whole product. It gives little sense of areas, project health, or the long-term inventory unless it is paired with a directory.

## Model 3: hybrid attention home, resume view, and area directory

This model separates three jobs that should not compete on one screen. The **attention home** opens with either “Resume” or “Choose next.” It shows one unfinished task that was deliberately left in progress, one recommended ready task, and no more than three alternatives. A quiet line offers explicit routes to “waiting,” “blocked,” “clarify,” “review,” and “all work.” The reason beneath every recommendation is specific: “due Thursday,” “you scheduled a review today,” “ready and matches Writing,” or “awaiting your decision.”

The **task-resume view** opens from the queue and makes the next action the visual anchor. Context is directly below: goal, area, status, commitment or next review, key material, and a concise activity trail. A persistent “return to attention home” control and a clear location path prevent a deep detail view from becoming a dead end. The **area directory** is the hierarchy: areas show a short health sentence such as “2 ready, 1 waiting for reply, 4 review later,” not an anxiety-producing total alone. Selecting an area exposes its normal task list and filters. It is a destination for planning or finding, not a tollgate before starting.

At **5 tasks**, this may look more structured than necessary, so keep the home minimal and let the directory stay in the background. The added value is rapid resumption after a break. At **50 tasks**, it has the best balance: the queue supports action, the directory supplies context, and the state views make non-actionable work visible without mixing it into today’s starts. At **500 tasks**, it is the most resilient of the three because the working surface stays small while the directory, search, saved filters, and periodic reviews handle scale. The caution is governance: stale status and vague task titles will defeat any model. The product must make clarification and review inexpensive.

This is the best accessibility fit if its structure is real rather than visual. The page should have named landmarks, a clear top-level heading, a predictable focus order, visible keyboard focus, native buttons and links, and status text that remains understandable without color. Do not use auto-playing motion, surprise reorderings, dense card mosaics, or timers as the only cue. Allow text size and display-density preferences, and preserve the user’s chosen sort and filters. These choices follow the guidance to avoid clutter and distraction, use simple consistent layouts and labeled cues, and help users reorient after interruptions. [1] [2] [3]

Implementation should first ship as rules, not machine learning. Store an area, task title, outcome, next action, workflow state, dependency owner or event, commitment date when real, review date or cadence, last touched date, pin/snooze state, and concise activity history. Derive the home queue from transparent rules and display the winning rule on each item. Keep status dimensions independent: a task may be **due soon + waiting for Sam**, or **no date + ready + review this week**. Let people correct the system with pin, defer, change review, mark waiting, mark blocked, or split the next action. Instrument only useful outcomes: time from opening the dashboard to starting, rate of successful resume, items with no next action, review completion, and queue overrides. Validate with people who experience interruptions or attention variability, rather than treating one designer’s comfort with a dense dashboard as proof of usability. [3]

**Verdict:** recommended. It challenges the proposed tile chain without throwing away its useful area structure. It gives one place for action, one place for orientation, and one place for depth.

## A concrete default flow

On opening the dashboard, show **Continue: Send corrected quote to Maya** with a one-line context cue, followed by **Start next: Outline the study plan — ready, 25 minutes, review scheduled today**. Then show at most three alternatives. Do not show a red wall of seven overdue tasks. If a real commitment is missed, name the fact neutrally and offer the recovery action: “Commitment passed Monday; choose a new date, mark waiting, or move to review.”

A task that cannot progress should leave the start queue. **Waiting** means another person or event is expected; show the expected event and follow-up date. **Blocked** means a prerequisite is missing; show what would unblock it and offer “clarify next action.” **Needs a decision** means the person is the blocker; phrase the smallest decision. **Ready** means it has a next physical action and no known external obstacle. **No date** means it is neither due nor invisible: it is governed by a review cadence or a consciously parked state.

Keep an **All work** view for trust and retrieval. It should support search, area, state, commitment, review date, and inactive/parked filters, but it should never be the emotional home screen. The home should normalize changing plans: missed dates, stale tasks, and too much work are information about the system, not evidence of personal failure.

## Caveats that matter

No dashboard can guarantee that an item is “never forgotten” when a user never opens it or when its review policy is left blank. The product can make neglect visible, preserve a durable inventory, and offer reviews; it cannot manufacture a commitment. Require a gentle default review cadence for active undated work, but make “someday / parked” a valid, low-pressure choice.

A small queue should not conceal risk. Provide a non-alarming indicator when there are commitments or reviews outside the visible few, such as “3 more items need review this week,” with a direct filtered route. Likewise, do not equate estimated duration or recency with importance; let the person override suggestions and correct the reason an item appears.

Finally, this is a behavioral model as much as a screen model. It succeeds only if capture is fast, next actions are concrete, waiting and blocked states are maintained, and periodic review is easier than avoidance. Test the first version with 5-, 50-, and 500-item realistic datasets, keyboard and screen-reader use, 200% zoom and narrow screens, and interruption-resume scenarios. Revise the selection rules before increasing visual complexity.

**References**

[1]: https://www.w3.org/TR/coga-usable/ "Making Content Usable for People with Cognitive and Learning Disabilities"

[2]: https://www.w3.org/WAI/WCAG2/supplemental/patterns/o1p04-clear-steps/ "Cognitive Accessibility Design Pattern: Make Each Step Clear"

[3]: https://www.section508.gov/design/digital-content-users-with-cognitive-disabilities/ "Designing Digital Content for Users with Cognitive Disabilities"

[4]: https://www.nngroup.com/articles/minimize-cognitive-load/ "Minimize Cognitive Load to Maximize Usability"
