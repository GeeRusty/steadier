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
Today = do · Overview = see · All work = find · Calendar = time · Compass = why · Weekly Review = decide.

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
- **Broken-link icon:** shown when a project, or a task in it, has no Goal Outcome or has an Imperative mismatch. These are also counted in Link check.
- **Arrows** are used only for open or move.

## Type and layout
- One small serif page title per screen; sans everywhere else.
- Three text sizes only; the task title is the largest content text.
- One column, 16 px edges.

## Today
- **Words:** Now · Next · Later only.
- **Later** = dated or booked for today, after Next. Nothing undated appears on Today.
- **Order is by time only.** No priority, scores or ranking, anywhere.

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

## Standing rules for anyone (or any AI) working on Steadier
- **Never sign in as the owner or create access passes** (session tokens, keys, login links) without asking the owner first, even temporarily and even for a screenshot.
- **Never deploy with a failing test.** Fix first, run the full test suite green, then deploy.
- **After a mock-up, wait for the owner's yes before building.**
