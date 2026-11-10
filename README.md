# Steadier / My Life

A life-orientation and responsibility app that holds the whole collection, surfaces a manageable few, and helps return to meaningful engagement. My Life uses Direction/Support as roles and Timely/Sustained as attention patterns—not high/low value or urgent/not urgent. Compass remains the user's decision system.

## Use the shared personal collection

Use the deployed application address when available. Sign in with the same Manus account on phone and laptop, then open **Server & Compass → Use shared personal space**. The personal v2 workspace lives in the managed MySQL database under the authenticated owner. The demo remains local, including the 5/50/200/500 and timing scenarios.

Existing browser records are never uploaded or removed automatically. Review initial transfer only into an empty server collection. If moving from Preview to a published hostname, download a full JSON backup on the old origin first and explicitly restore it in the shared personal space on the new origin. See `docs/Shared-Server-Guide.md` for device, transfer and Compass instructions. A working Preview is not confirmation that the latest source is published.

**My life today** combines a saved Compass intention/next task with explained attention. Approaching/passed real commitments stay visible outside the five-suggestion cap. **Projects & outcomes** holds purpose, milestones and observed evidence; achievement is deliberate, not inferred from completed-job counts. **My life matrix**, All work, Review, Waiting & blocked, Life areas, Completed steps and the full **Server sheet** keep the rest discoverable. Suggested identity/preparation remains provisional; the app does not look up licence expiry or invent real deadlines.

## Sync, backup and privacy

Cloud edits are queued/serialized and compare against a server revision. Another device's intervening changes cause an explicit conflict rather than silent last-writer-wins. Both versions remain available for download and deliberate choice. Status distinguishes browser-only, loading, saving, synced, offline/pending and conflict; Compass only receives the accepted server version. Owner-scoped browser caches preserve pending drafts but can be cleared or evicted. Closed-browser sync is not guaranteed.

Full JSON backup/checked restore preserves task/project IDs, relationships, meaning, outcomes, milestones/evidence, matrix, intention, focus and trial metadata. Original v1/v2 browser keys remain intact. Pre-replacement server recovery and up to three displayed recovery copies aid undoing a deliberate replacement; keep downloaded off-device copies too. Invalid records are protected, never silently replaced with an empty/sample export. CSV is a sheet/interchange format, not full restore. Additive imports create fresh task IDs and can add duplicates.

All private workspace access requires a valid project-bound application session. Private AI context requires a separate opaque revocable expiring bearer key stored hashed; it cannot write. The feed includes all areas, temporal provenance, readiness, outcomes, intention and freshness. Neither public links nor query-string credentials expose personal records. Key issuance is explicit, plaintext is shown once, and the client can download an OpenAPI description without including the key. The native read-only MCP server is described below; no separate Google Sheets sync is implied. The Claude client still needs the user to configure and approve it.

A running shared focus has one device owner. Other devices show the saved checkpoint and can explicitly take it over. A timer never completes a task automatically. **I'm drifting** offers a smaller step, break or conscious plan change without guilt or monitoring other apps.

## Claude Compass connector

The remote MCP endpoint is `/api/compass/mcp`. Configure Claude through **Customize → Connectors → Add custom connector**, using the published HTTPS URL and normal sign-in with automatic dynamic registration. Read `docs/Claude-Connector-Guide.md`; fixed-key Request headers are a limited-beta alternative, not the required path.

The official pinned SDK v2 serves current JSON and legacy stateless Streamable HTTP/SSE clients. Four strictly read-only tools expose full saved context, task detail, project detail and the sheet. Every request validates the existing hashed expiring reader capability; all successful replies remain private/no-store even when the SDK sets legacy SSE headers. Current context is not always-on monitoring and cannot prove focus.

OAuth resource/issuer discovery, public client registration, PKCE S256, owner-consented one-time codes and binding/replay guards persist in additive MySQL tables. Authorization grants only a 90-day reader key, visible as Claude read-only in the normal revoke controls. Approval requires a standalone browser page; existing Manus nonce/cookie login returns only to the fixed consent path. No plaintext access token/code/verifier is persisted, and consent does not mutate task records. `shared/compassConnection.ts` holds the canonical public resource/issuer; change it deliberately if self-hosting on another hostname.

`server/steadier/mcp.ts`, `compassOAuth.ts` and `oauthRepository.ts` own the connector; `ClaudeConsent.tsx` and `ClaudeSetup.tsx` own permission/setup. Focused SDK/OAuth tests plus `python3 scripts/claude-connector-smoke.py` (fresh synthetic-only fixtures first) check approval, no-write reads, private responses and revocation. Actual Claude account configuration remains a user action.

## Voice

Voice is a mandatory capability, but each use is opt-in. Browser dictation feeds an editable draft; read-aloud has stop controls; focused voice actions require explicit confirmation. Browser/webview support varies and recognition may require internet or remote vendor processing. No always-on microphone, guaranteed offline recognition or clinical attention improvement is claimed. A full browser/keyboard dictation is the honest fallback.

## Run and deploy

The pinned Node/pnpm starter uses React, TypeScript, Vite, Express, Drizzle and MySQL. Managed application/server authentication and database settings are supplied by the project, not committed secrets.

```bash
npx --yes pnpm@10.18.0 install --frozen-lockfile
npx --yes pnpm@10.18.0 db:migrate
npx --yes pnpm@10.18.0 dev
```

Port defaults to 3000 on 0.0.0.0 and honors `PORT`. The existing Dockerfile installs dependencies, builds both frontend/server, and runs `node dist/index.js`. `/api/health` is unauthenticated but fails readiness until required tables are queryable. Apply additive checked-in migrations separately; development and publication share the managed database. Do not run destructive SQL or reset application records to prepare a test.

```bash
pnpm check
pnpm test
pnpm build
```

`dev:static`/`build:static` remain for the local demo/offline-shell regression, not the complete shared application deployment. All browser API URLs are relative. The application owns its PWA manifest and production service worker, which does not cache API/authenticated data. Offline shell caching does not mean reliable background reminders.

## Modules and checks

Pure domain modules under `client/src/domain` hold dates/workflow, life identity, parsing/interchange and cloud reconciliation. `useWorkspace` owns original browser stores; `useSharedWorkspace` wraps it with explicit server mode and generation guards. `server/steadier` owns validation, authenticated routes, CAS persistence, recovery, key permissions and context/sheet projections. Existing OAuth/cookie validation remains in `server/_core`. `shared/cloud.ts` is the wire contract.

The software suite and isolated browser scripts cover life framing, full backups, migration, readiness/dependencies, sync conflicts and permissions. Browser scripts require Python Playwright and Chromium. These are synthetic-test evidence, not actual Android microphone/OAuth usability evidence:

```bash
python3 scripts/prototype-smoke.py
python3 scripts/trial-smoke.py
python3 scripts/trial-edge-smoke.py
# Creates only explicitly synthetic private test users; writes secrets to ignored .webdev/.
pnpm exec tsx scripts/server-smoke-fixtures.ts
python3 scripts/server-smoke.py
python3 scripts/server-final-flows.py
```

Do not import the user's real browser records into test fixtures or source. `docs/Steadier-Product-Investigation.md` and supporting reviews preserve the investigation; `plan.md`, `TODO.md` and implementation reviews record subsequent changes and limitations.

Reliable closed-app reminders, proactive scheduled outreach, habit/drift detection, actual Compass configuration, calendar-rule recurrence, attachments and LLM-powered ingestion remain separate decisions. Current recurrence is days after completion. Start with a week of small real use and regular backups; evaluate missed imperatives, appropriate engagement and meaningful outcome progress rather than simply how many jobs disappear.

## Claude connector: read & changes (v1.1)

- Approval level is chosen on the consent screen: **Read only** or **Read and changes** (`steadier:read steadier:write`). Existing approvals stay read-only.
- Every connector write runs through `server/steadier/changes.ts`: the full workspace is snapshotted into `steadier_workspace_backups` in the same transaction as the change; if the snapshot fails, nothing is written. The newest 20 snapshots are kept.
- Deletes from Claude only create a `steadier_pending_deletes` row; the owner confirms or keeps it in the app (Today banner, or Server & Compass → Claude changes & server backups). Owner deletes and restores also snapshot first.
- Restore and the manual full export (`/api/steadier/export`) are owner-only, cookie-authenticated routes. Claude can list backups but cannot restore.
- History lines from Claude start with `Claude:` and carry an Adelaide timestamp with offset. All server dates and Claude-facing times use `Australia/Adelaide` (`shared/time.ts`).

## Reminders: calendar feed and in-app tones

- **Calendar alarms:** Settings → Calendar alarms creates a private subscription link (`/api/calendar/<secret>/steadier.ics`; only its SHA-256 hash is stored in `steadier_calendar_feeds`). Open tasks' deadlines, preparation days, review and start dates become all-day events; notes are never included, and titles can be hidden. Creating a new link revokes the old one. Google Calendar uses its own per-calendar default notifications and refresh schedule; VALARMs serve Apple/Outlook.
- **Tones:** `client/src/lib/tones.ts` synthesises a calm end-of-focus bell and a softer halfway check-in (blocks ≥ 10 min) with optional vibration and a spoken prompt. Per-device settings live in localStorage. They play only while the app is open, on the device that owns the running timer.
- Starting a scheduled task uses its planned slot length (falling back to its estimate); unscheduled work keeps the 10-minute focus start. If a scheduled task is completed early, its countdown continues as a timebox, while remaining time is not attributed as task work. Timer expiry never completes work.

## Compass layer, batch 1 (v2.2)

- Suggestions stay suggestions: role/pattern/preparation date set by Claude are saved `suggested` (tasks) or `compass.labelsConfirmed:false` (projects); catch-alls and decisions set by Claude are `confirmed:false` until the owner confirms in Steadier.
- Imperatives: `workspace.imperatives` (title, reason, active/retired, setOn, Notion link, decision, history). Soft limit 8. Quiet flag after 7 days without linked movement.
- Tasks/projects: `compass` field — Imperative links, catch-all (Life Admin / Erosion Guard, tasks only), decision outcome (Promote, Sustain, Delegate or minimise, Retire), Notion link (projects).
- Orphan check: open tasks with no project, Imperative or catch-all are listed in Review (flagged, never blocked); count on Today's Compass strip.
- Older saves load with empty defaults; links to deleted Imperatives are dropped quietly.
- Claude tools added: `list_my_life_imperatives` (read), `set_my_life_placement` (write, guarded with backup).

## Weekly Reality Review and Floor Check (v2.3)

- `workspace.reviews` (max 300): date, Floor Check (money OK/concern, one "is it done?" per unconfirmed commitment, capacity low/medium/high, notes), Imperative decisions, Imperatives held, quiet Imperatives, unplaced before/after, notes.
- Unconfirmed commitments: open steps whose planned day or deadline has passed, or waiting over 7 days.
- Saving applies only the owner's answers: Done completes (repeats roll forward), Drop moves to Someday (never deleted), Not yet is noted in history; Imperative decisions are owner-confirmed, Retire retires.
- Due after 7 days: "Review due" chip on Today's Compass strip and a banner on Review. Draft kept on the device until saved.
- Every question can be read aloud and answered by voice; notes can be dictated.
- Claude reads review status inside `list_my_life_imperatives` (`weeklyReview`); Claude never fills a review in.

## Compass map: Pillars → Value Goals → Goal Outcomes → projects (v2.4)

- `workspace.goals` (max 400): each item has a `level` (pillar, value-goal, outcome), `parents` (links one level up, many-to-many, each `{id, confirmed}`), and for outcomes `projects` (`{id, confirmed}`). Existing project records are unchanged.
- Links to missing items are dropped quietly; links to the wrong level are rejected. Items are retired, never deleted.
- Compass map view: tree (shared items appear under each parent), add with dictation, multi-parent chips, confirm/reject suggested links, link projects, gaps panel, read aloud.
- "Why" line on every task and project editor: the full chain up to the Pillars, merged and read aloud.
- Gaps (flag, never block): Pillar with no Value Goal; Value Goal/Outcome not linked upward; Value Goal with no Outcome; Outcome with no active project or no movement for 14+ days; active project not linked to an Outcome; suggested links awaiting confirmation. Shown on the map, as "N map gaps" on Today's Compass strip, and as the Map step of the Weekly Reality Review.
- Claude: `read_my_life_compass_map` (read) and `suggest_my_life_link` (write scope; saved as suggested, backed up first, logged in history). Claude cannot create, rename or retire map items.

## Orphan protection (v2.5)

- A task is placed only by a confirmed project, Imperative, Life Admin or Erosion Guard. Suggestions (Steadier's or Claude's) stay unplaced until the owner taps Confirm. Claude's project and Imperative links are now marked suggested (`compass.projectSuggested`, `compass.imperativesSuggested`); the owner's own links never are.
- Stages are computed from `createdAt` on every read (app open, return to screen, every 5 minutes); nothing is stored, so a closed app never misses a stage. 0: under 8h. 1: 8h, quiet dot. 2: 24h, or at once with a deadline, fixed time or reminder; flag, and a once-a-day Today banner (per device, read aloud). 3: 3 days, or due within 2 days; "overdue for placement", top of the list.
- Counter pill at the top of Today and in the top bar on every page; opens the list with one-tap Project, Imperative, Life Admin, Erosion Guard and Confirm.
- Weekly Reality Review step 2 (lead-in): only what is still unplaced, "Does this belong to a project?", Life Admin and Erosion Guard open counts, Life Admin open over 14 days (from `compass.catchAllSince`, falling back to last change), and a suggestion when 3+ similar jobs land in Life Admin within 60 days.
- `list_my_life_imperatives` → `unplaced` now includes capturedAt, ageHours, stage, stageLabel, urgent, awaitingConfirm, Life Admin / Erosion Guard counts and Life Admin over 14 days.
- No database change; existing records load unchanged (new fields are optional).

## Compass map level pages (v2.5)

Every Pillar, Value Goal and Goal Outcome has its own page at `/#map/<id>` (the phone back button moves between pages, and the address can be shared with Claude). Each page shows what it sits under, what sits under it (Outcomes show the projects serving them), the Imperatives that reach it, its gaps near the top, details, read aloud and its change log. Links can be made from either end; a link that already exists is never changed by adding it again, so suggested links stay suggested until Confirm and confirmed links are never downgraded. Projects show "Serves outcomes" and a tappable why-chain; tasks show the same chain. Imperatives gain optional direct map links (old records load unchanged) and a new gap flags active Imperatives that are not on the map. The connector's map and Imperatives read tools gained `pagePath`, `imperatives`, `mapLinks` and `onMapThroughWork`; all existing fields are unchanged. Smoke test: `scripts/map-pages-smoke.py`.

## Subtasks (v2.6)

Any task can have subtasks, Todoist-style, up to 4 levels deep. A subtask is a full task with its own dates, time slot, reminders (with voice) and repeat. Small steps (the checklist) stay as simple ticks.

- Add subtasks from a task's editor (Subtasks section), or move any task under another with "Subtask of".
- Lists show subtasks indented under their parent with a collapse arrow and a 2/5 progress badge. Every card shows "under …" when its parent is not shown above it.
- Finishing a parent with open subtasks asks first: finish them too, or keep them open. Finishing the last subtask offers to finish the parent.
- A repeating parent's next occurrence gets fresh copies of finished subtasks (dates moved by the same amount), and open ones move across. Nothing is deleted.
- A subtask under a confirmed parent counts as placed (orphan protection). Recommendations suggest the subtask, not a parent that still has open subtasks.
- Claude/ChatGPT: `add_my_life_subtask` and `set_my_life_task_parent`. Their links are always "suggested" until you confirm, and they cannot change links you confirmed. Deleting a parent moves its subtasks up a level.

## Places and location reminders (v2.7)

- **Near me** page (menu): saved places, "I'm at…" to show a place's tasks, nearest-first list with distances, and Read aloud.
- Add a place by address search (signed in; uses the built-in Google Maps service, rough area only), "Use my current location", or pasting a Google Maps link / coordinates. Arrival distance 50 m – 2 km.
- Each task can have one **Place** (task editor). Cards show "at Bunnings".
- **Remind me when I arrive** (off by default): while Steadier is open on screen, arriving plays the reminder tone, speaks the tasks for that place and shows a notice, once per visit and not again within 30 minutes. Optional "Keep screen on".
- Live location stays on the phone and is never saved or sent; only saved places sync. Removing a place keeps its tasks.
- Limit: a web app cannot watch location when closed or in the background.

## Today redesign (v2.8)

- **Today / Overview switch** at the top of Today (no sixth tab). Today shows one large **Now** card (red "now" mark on in-progress blocks, big Start/Done, details tucked behind the title), a **Next** card, suggested placements as dashed cards with an inline **Confirm** and source tag (Steadier, Claude or ChatGPT), one **Needs attention** card, today's timeline, and Other tasks.
- **Four states** on every screen, checked in order: Scheduled → Chosen → Suggested → Held. Counts read "n active · n held" (active = scheduled + chosen). Someday, Deferred and Waiting/Blocked appear as small reason tags on held cards. Display only; no stored data changed.
- **Intention bar** stays at the top and folds on scroll; tap to type or speak. **Re-anchor** reads the intention and the Now task aloud.
- **Finished early** shortens a timed block to end now, then completes it.
- **Status marker** replaces the header badge. A red **risk banner** appears only when a backup download is 7+ days overdue, sync has failed, or the browser could not save.
- Red is now reserved for "now" and genuine data risk; other warnings use amber.

## Design approach (applied from v2.8 Today to every screen in v2.9)

1. **Size follows importance.** The thing you act on (a task title, the main button) is the largest; details step down in size and colour.
2. **Order follows use.** What you came for comes first; add forms, setup and explanations follow it.
3. **One main action per section.** One solid button; the rest are quieter.
4. **Show a few, reach all.** Long lists open with the most urgent few and a "Show more" link; nothing is hidden for good.
5. **Same shapes everywhere.** One heading style; four task states (Scheduled, Chosen, Suggested, Held) look the same on every screen; red only for "now" and real data risk, amber for warnings.
6. **Nothing removed.** Every control and explanation is still on its screen.

v2.9 clarity pass: list rows (title 16px, details 12–13px) on All work, Review, Waiting, Life areas and Completed; "n active · n held" in list counts; compact page titles; Review's unplaced list shows 5 then "Show more" (previously stopped at 12); Time & plans fixed to one column on phones with a dated week label; Backups puts Download first as the main button, phone help after; Matrix explanation moved below the cells; Near me, Server & Compass and Server sheet titles match the others.

## Pillar strip (v3.0)

- A row of **eight Pillar slots** at the top of the Compass map, and a slim version on Today under the intention bar.
- Each slot is a shape as well as a colour: **✓ green** steady, **• amber** needs a look, **! red** gone quiet, **dashed** free slot.
- Green: Value Goal → Goal Outcome → confirmed project chain in place, no gaps, something moved in the last 14 days.
- Amber: a gap in the chain, a suggested link waiting, or 14–29 quiet days. A brand-new Pillar is amber (a gap, not a failure).
- Red: 30+ quiet days under a chain that exists, or open work past its deadline under the Pillar.
- Suggested (unconfirmed) links never count as a chain or as movement. Reading the map never changes it; nothing is blocked.
- Tap a Pillar to open its page; tap a free slot to add one (Today's free slot jumps to the Pillar form on the map). More than eight Pillars are never hidden: a "+n more" link opens the map. **Read Pillars** speaks every Pillar and its reason.
- Rules live in `client/src/domain/pillarStrip.ts` (tested); phone check: `scripts/pillar-strip-smoke.py`.


## Reschedule or skip a recurring task instance

- Open a recurring task and change **This occurrence day** and/or its start time to move just that instance. The repeat pattern and usual time remain unchanged, and the next occurrence returns to the pattern.
- For a weekly repeat, choose **Skip this week's instance**; other calendar repeats use **Skip this occurrence**. The skip is staged in the editor and takes effect when you save. It records the skipped instance and continues the series rather than completing or deleting it.
- The calendar view, scheduled work, reminders and subscribed calendar feed reflect the moved or skipped instance without duplicating the regular slot. If both an end date and an occurrence limit are set, the earlier limit ends the series.
- Older backups without the newer occurrence fields remain importable.
