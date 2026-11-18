# Steadier design language

Every change to Steadier must follow this. If something doesn't serve a screen's job, it moves.

## Principles
1. **Orientation first:** every screen answers "where am I, what's next" first.
2. **One thing, once:** an item appears in only one place per screen.
3. **Show, don't explain:** meaning comes from position, shape and colour. Explanations sit behind an info icon.
4. **Calm, not urgent:** red only means now, or a genuine risk.
5. **Decided vs suggested:** confirmed is solid; suggested is dashed until the owner confirms.
6. **Honest time:** show the likely finish, not the hoped-for one.
7. **Built for working hands:** voice first, big targets, glanceable.

## Screen jobs
Today = do · Overview = see · All work = find · Calendar = time · Compass = why · Weekly Review = decide · Assets = look after.

## Colours (three jobs only)
- **Green** = serves an Imperative (left bar).
- **Red** = the now line, or a genuine risk.
- **Grey** = held, quiet, not now.

No other colours carry meaning.

## Card signals
- **Solid card** = ready. **Faded card** = not set up (dots). **Dashed outline** = suggested.
- **Life Admin / Erosion Guard** = a small text label, no colour.
- **Status chips** show ONLY what's off normal: at most two per card, the most time-critical first. On track shows nothing.
  - The chips: `⏱ −10m` / early · `⏱ +20m` · slipped · overdue 2d · moved 3× · quiet 9d · review due
  - Chips are grey. A chip turns red only when it will clash with a fixed booking or deadline.
  - `⏱` shows only at 10 minutes or more early or late, on Today and the Calendar Board alike (decided 17 Nov). The Now card's "likely finish" follows the same rule.
  - **Unplaced markers** (the unplaced pill, stage badges, row edges and the overdue panel edge) are grey too, decided 17 Nov: later stages are heavier, not a different colour. No amber anywhere.
  - **Leave by** is quiet grey text, not a chip: "leave by 10:35" on a booked Today row (and the Up next line) at a place with an "Allow to get there" time. No allowance on the place = nothing shows. There is no distance estimate.
- **Broken-link icon:** shown when a project, or a task in it, has no Goal Outcome or has an Imperative mismatch. These are also counted in Link check.
- **Arrows** are used only for open or move.

## Type and layout
- One small serif page title per screen; sans everywhere else.
- Three text sizes only; the task title is the largest content text.
- One column, 16 px edges.

## Today
- **Sections, top to bottom:** check-in line and **Needs attention** · **Now** · **Next thing** · **Any time today** · week strip · the agenda, with **Free** rows in its gaps. These words replace the old "only Now · Next · Later" rule (owner, 18 Nov).
- **Now** = only what's running: a booked block in progress (to its likely finish) or the focus timer. Nothing running = no Now section at all. A booking and a running focus on different tasks both show, each labelled; neither is picked for you.
- **Next thing** = only the owner's chosen Next thing, always labelled "your choice". The next booking never fills it.
- **Any time today** = dated for today with no clock time. Nothing undated appears on Today.
- **Agenda** = every timed item today in time order. Times on the left, a thin line, and the red now line (just after a running block, never across its text). Each booking is one row: time range and length, title, round done circle. Height grows with length, from 52 px at 30 min or less to a 96 px cap at 3 h. Past and done items fade; a slip never fades and keeps **Keep going / Move / Drop**. The next booking's "in 25 min" (and its leave by, shown there only) sits on its own row above it, not in Now.
- **Free** = a gap of over an hour between bookings, or from now to the next one, counted from now. One quiet grey row (not dashed: dashed means suggested) with **+ Add**, which opens capture at that time.
- **Week strip** = Mon–Sun, today highlighted, a quiet grey mark sized to booked time only (never undated, flexible or deadline items). Display only.
- **One thing, once** has one exception here: the agenda is the whole day, so a running block or a booked Next thing also shows on its agenda row.
- **Order is by time only.** No priority, scores or ranking, anywhere.
- **Decision change, 18 Nov 2026:** replaces decisions 1 and 2 of 12 Nov. Now was "the booked block, else the focus timer, else the chosen Next thing with Start", and Next was "the chosen Next thing, else the next booked item". Now: Now shows only what's running, Next thing is only the owner's choice, and "Up next in X min" moved from the Now card to its own agenda row.

## Task editor
- Order (owner, 18 Nov): title with the done circle on its left · When (summary, type when, day / start / length in h and min, Booked switch) · Repeat (summary, tap to open) · Reminders · Place · Next physical step ("Title is the step" tick) · Where it belongs (summary, tap to open) · Notes, subtasks, small steps, lists · More (folded).
- One save model: autosave with "Saved". The only thing that waits is a voice draft (dashed, **Keep it** / **Undo**). Explanations sit behind the **i**.
- Times read "9am–4pm · 7h", never "9:00–4:00". "Finish by" is one date-and-time row. "Not before" covers both old hide-until dates; "Start preparing from" stays separate because it hides nothing.

## Pillars & Goals
- One card per Pillar in the owner's own stored order, never sorted by activity, all at the same strength, styled like Project Outcomes rows. Name, one-line definition (or "+ Add definition"), then "1 Value Goal · 1 Outcome · 2 projects". Green bar only when an active Imperative links to the Pillar or anything under it. Grey chips, at most two: "no definition", "no Value Goal", "quiet 30d". No counts in the header (owner, 18 Nov).
- Tap to open: Value Goals › Goal Outcomes › projects, with "+ Add Value Goal" / "+ Add Outcome" in place. "+ Add" rows are plain grey text, never dashed (dashed means suggested). Enter adds and keeps the box open; pasted lines add one each.

## Calendar
- **Blocks** are neutral cards with primary text on a neutral surface. The title comes first, then the time and chips.
- **Colour:** the green left bar is for Imperative work only. Blue/lavender fills and lock icons are gone.
- **Day** shows the title, time and chips. **Week** shows titles only, with one short "Nh free" line under each date. **Month** previews up to three items per day.
- **Every hour row is the same height**, and the time column fits two-digit hours.
- **Explanations** live in the page menu's "How this calendar works"; there are no boxes on the page. A real risk (an overlap) is one short line.
- **Board** (beside Day/3d/Week/Month) works like a departure board: one line per booking, **time · task · status**, with the status last.
  - Status shows only when something is off. The words are 1–3, in sentence case: Done, Due, Now, Slipped.
  - The likely finish ("~10:55 · +10m") shows only when it is **10 minutes or more** past the schedule. Below that, nothing shows.
  - Red only when the slip runs into the next fixed booking or a deadline.


- Priority, scores or ranking.
- Data changes, orphan rules, confirmations, or the three dots.

## Review due and Weekly Review
- **Header:** the same as Today (title, date · sync, ⋮). The theme toggle, Undo and Read aloud live in the menu. No footer.
- **⋮ (This page) on every page:** Read aloud, Undo and Theme. App options (bottom of ☰) keeps Flag, Connection and the Today extras.
- **One Read aloud per page**, in ⋮. It reads the page: on Review due, the review card and the unplaced list; on Weekly Review, the current step.
- **Explanations** sit behind the **i**, word for word, never on the page.
- **Weekly Review steps:** one line, "Step n of 10", with a thin grey bar. Tap it for the step list. Back and Next stay.
- **Review card time:** first review 30–40 min, after that 15–25 min.

## One count, one check-in
- **Needs attention** is the only count. One row per kind; the total is the sum of the rows, the same on Today and Overview.
- **The weekday check-in** is one line at the top of Today showing the first question, never a number. Answered or Later, it folds until the next check-in (08:00 / 17:00). It never pushes the day off the first screen.
- **Compass Library** links live in the menu, not on a page.

## Lists
- **List of lists first**; tap one to open it. Forms appear only when asked for.
- **Template / Run / Runs.** The template is never ticked. One round tick per item on a run; edit and delete behind **⋯**.
- **No counters or dates on items.** The only date is the run's.
- **Progress on a parent card** is a grey chip when the card has room; with two chips already, a quiet line inside the card. It never replaces "review due" or "moved".
- **Claude's items are dashed** (suggested) until the owner confirms them.

## Assets & Upkeep
- **Grouped by type**, counts singular or plural ("Vehicle (1)").
- **Two chips at most:** condition (none until checked), plus one due chip (service due/overdue, revisit due/overdue, reading due). Everything else is plain text.
- **Edit is a button, Delete is behind ⋯, Retire is a solid, quiet button at the bottom** (it's a decision; dashed means suggested).
- **Ticking a task made from Upkeep due asks once** ("Log the service now?", Yes / Not now). Not now changes nothing.
- **No second reminder system:** due upkeep is one "Upkeep due" row in Needs attention (counted once per item) and the Weekly Review's Action step. Create task only opens a draft.

## Front of Mind
- **One list, calm:** no counts that nag; Overview's row has no number.
- **Two chips at most**, only what's off normal: added by Claude, suggested: Let go (dashed), quiet Nd (after 30 days).
- **Four actions, the same everywhere:** Make it a task · Promote to Imperative · Keep · Let go. Promote is a draft; Imperatives change only in the Weekly Review.
- **Claude adds, rewords (History kept) and suggests.** Only the owner decides.
- **Idea in + saves on Create or on close** (2026-11-16). If the draft had already autosaved as a task, that task is removed, so an idea never stays behind as a task. Voice and review-only drafts still need Create.

## Photos on tasks
- **Stored once, outside the workspace.** A task holds only a reference (fingerprint, size, Before/After label, markup as drawing instructions). Workspace backups never copy a photo. Files: `PHOTO_DIR` (host `~/steadier-photos`), nightly add-only backup `scripts/backup-photos.sh` → `~/backups/steadier-photos`.
- **Never rejected:** over 1 MB or 2048 px is made smaller (phone first, server always). HEIC is converted on the server.
- **Location off by default:** the file is written with no hidden details and checked. "Change" on the task sheet's photo line switches it, for new photos only.
- **A deleted photo is kept 30 days** (longer only while a kept workspace backup still points at it), then removed from storage and its backup.
- **Calm cards:** a small camera and the count in the meta line on Today (rows and the Next-thing picker), All work and project task lists. Never a thumbnail, never a chip.
- **On the task sheet, Photos sit at the top** (under Done, above the card), so they're in sight when the task opens. The Before/After label sits on the photo, not as a chip.
- **Markup has one ink, yellow,** so red stays for real risk. The original is never changed; copies you save have the markup drawn in.
- **+ Photo always starts a new captured task** (not-ready, for Sort), titled from the words given, else "Photo job". It never goes on an existing task or the Now task. Adding to an existing task is done from that task's sheet.
- **One question at a time:** ticking a task with a Before and no After asks "Add an after photo?" once. For an Upkeep task, the photo is part of "Log the service now?", never a second sheet.
- **Claude and Grok never see photos,** their fingerprints or markup text.

## Capture to a project
- **"capture to Kingston: …"** (by + or voice; the colon is optional when spoken) puts that one task in Kingston. No session starts.
- **"capture to Kingston"** on its own starts a session; **"end capture"**, End, or choosing another project ends it. It never ends on its own. The session is kept with the workspace (`captureSession`), so every device and the voice page see it.
- **Quiet banner:** one grey line on every page, "Capturing to Kingston · End". No colour, count or timer. Tapping the name switches project.
- **Place only:** the same fields picking the project in + sets. Tasks still land not-ready, for Sort. History line "Captured to Kingston (session)".
- **Session photo:** a + photo during a session starts a new task in that project, titled from the words given, else "Photo job".
- **Matching:** active projects whose title contains the name; two matches ask, none match lists the projects. Nothing goes to a wrong project.
- **Not affected:** Front of Mind ideas, Paste anything, notes, lists, and tasks Claude or Grok add through the connector.

## Imperatives

- Standard header (page name once, date), the i holds the explanation word for word, the ⋮ (This page) menu has Read aloud, Undo and Theme, as on every page (Theme moved there from App options, 17 Nov); the five tabs and + as everywhere.
- Cards fit the screen width, with a green left bar for an active Imperative. Dates are written "27 Oct" (year only outside this year).
- Chips stay grey (quiet, moved, review due) with the "projects · open steps" line.
- On the map: a direct link has a small outlined **Unlink** button; a goal reached through work names its route ("via Move house", or "via 2 projects", tap to see them) and has no Unlink.
- The link picker hides behind **+ Link**; the Add form behind **+ Add an Imperative**; Retired is folded.
- **Edit** is outlined, **Retire…** is a grey filled button set apart on the right, and asks to confirm (approved 17 Nov).

## Link check

- Standard header (page name, date), its explanation behind the i, ⋮ with Read aloud, Undo and Theme; five tabs and +. Moved 17 Nov. The cards and buttons are unchanged, and the Weekly Review's Link check step is unchanged.

## Phone notifications

- Only a task's own reminders and leave by; never Needs attention, Upkeep or reviews (17 Nov). Each kind has its own switch; quiet hours drop, never hold. Settings in ⋮ › Notifications on every page. Encrypted web push; the in-app chime takes a reminder when Steadier is on screen.

## Retired pages

- Evidence Feed and Site Cards are off the menu since 17 Nov (`RETIRED_VIEWS` in `domain/pageNavigation.ts`). Their screens, code and data are kept; taking an id out of that list brings the page back.

## Standing rules for anyone (or any AI) working on Steadier
- **Never sign in as the owner or create access passes** (session tokens, keys, login links) without asking the owner first, even temporarily and even for a screenshot.
- **Never deploy with a failing test.** Fix first, run the full test suite green, then deploy.
- **After a mock-up, wait for the owner's yes before building.**
