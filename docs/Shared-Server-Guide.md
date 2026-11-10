# Shared personal server and Compass access

**Live app:** [https://steadier-9wkmejo8.manus.space](https://steadier-9wkmejo8.manus.space). The server release was published and its private JSON/CSV AI access was verified on this address.

The server upgrade gives the personal collection one private database home. Sign in with the same Manus account on your phone and laptop, then select **Server & Compass → Use shared personal space**. Sample scenarios remain browser-only and cannot populate or replace the shared personal collection.

The startup repair remembers a deliberate shared, original-browser or sample choice in the same browser. Shared reopening always rechecks sign-in for the saved owner; a stored preference is not a credential. A signed-in first visit to the canonical published app defaults to shared when no choice exists, while unselected Preview stays local. If sign-in expires, the owner changes or the server cannot open, a guarded screen offers sign-in/retry and an explicit browser/sample escape. It does not silently upload your old jobs or run another device's focus timer. Browser storage restrictions or clearing storage can prevent remembering; use the same browser and account. This does not replace the full-backup migration below.

## Bring over the records you already entered

Your old browser records are not uploaded or deleted automatically. If you are still on the same browser and website address, **Server & Compass** can show the original collection and offer a checked initial transfer into an empty server collection. Download its full backup first, inspect the counts, and explicitly confirm the upload. The original keys stay intact.

A published website has a different browser store from Preview. Before moving from Preview, open the original personal browser space and download a **full JSON backup**. On the published website, sign in, open the shared personal space, then choose **Backups & trial → Restore full backup** and select that file. Check the task/project counts and explicitly confirm replacement. This retains the saved identities and links. CSV is not a full backup, and additive import is not exact restore.

**If your phone refuses the download:** keep the original Preview open and use **Backups & trial → Copy backup text**. If automatic copy is blocked, the private text is shown with **Select all backup text**; use your phone's Copy command. On the published app, select your shared personal space, open **Backups & trial → Restore from backup text**, paste the complete JSON and choose **Check pasted backup**. Check the displayed task/project counts before confirming replacement. Wait for **Synced** before asking Claude to read again. Pasting/checking alone does not replace anything. Never paste the backup into a public chat, and do not clear the original browser data. When possible, keep an independent file copy too.

If the shared collection is already non-empty, do not use initial transfer to overwrite it. Download the current server collection before deliberately restoring a different backup. A confirmed replacement also has a revision check and a retrievable server recovery point. Keep your own downloaded files outside the browser and server.

## Recognise what is actually saved

The main status strip distinguishes browser-only data from the shared personal space and shows loading, saving, synced, offline or conflict. **Synced** means the current accepted server version; **pending** means this browser has changes that Compass or your other device cannot yet read. A last-confirmed timestamp is not a guarantee that every device is online.

Edits are sent in sequence with the server revision they were based on. If another device saved first, the stale write is rejected rather than silently overwriting it. The conflict panel lets you download both versions, adopt the server version, or deliberately replace it with the browser draft. Counts alone do not describe the differences. Make that choice carefully.

The app refreshes while visible and when you return. This is not a guaranteed background sync process after the browser closes. Browser recovery caches may retain pending drafts, but clearing browser storage can remove those drafts. Avoid changing accounts or closing a browser with unsaved changes without a full backup.

A running focus session has a device owner. A second device can see the saved step and checkpoint without running a duplicate timer. **Take focus on this device** is an explicit handover. A timer is still an in-app aid, not a reliable closed-app alarm or evidence of your attention.

## The sheet and the AI feed

**Server sheet** displays the full collection with life areas, purpose, Direction/Support × Timely/Sustained identity, available state, next action, outcome, real deadline, preparation/source, review, blockers and evidence. It is another view of the database, not a second spreadsheet that can drift away from the app.

**Download saved server CSV** requests the current saved sheet. That downloaded file is a snapshot. The private AI sheet endpoint generates the latest saved CSV each time an authorised AI requests it. The richer JSON context includes the whole saved framework and planning context; it is not restricted to the five attention suggestions.

Under **Server & Compass**, explicitly acknowledge the read-access scope and create an expiring read-only key. Copy it immediately into a trusted private authentication configuration. The server keeps only a hash and cannot later reveal the original key. The key can be revoked; it cannot edit tasks. Anyone who possesses it can read the saved personal context, including notes and outcomes, until expiry or revocation.

Use the published website's HTTPS origin with these paths:

```text
GET /api/compass/context
GET /api/compass/sheet.csv
Authorization: Bearer <private read-only key>
```

Do not put the key in a URL, public sheet, shared chat, source code or document. Data responses are private and not publicly cached. The app can download/copy an OpenAPI description for a compatible API client; it contains the service address and operations, not the private key. Configure the key separately in authentication settings. Preview is not a dependable long-term AI address.

The app also now supplies a native read-only Claude MCP connector; see [Claude connection instructions](Claude-Connector-Guide.md). Connecting Claude does not move Preview records into the server or grant task-edit permissions. Google Sheets is not a separately synchronised store. Prefer reading current context before planning over attaching an old exported file as permanent knowledge.

Compass should check the server revision, update timestamp and planning date/timezone before giving advice. The server cannot see edits that another offline device has not sent. Suggested preparation is not a real deadline; the user remains responsible for confirming life identity and actual commitment dates.

## Keep the boundaries

Steadier holds responsibilities, outcomes and facts. Compass helps the user choose appropriate engagement. Voice stays explicitly activated, and the saved intention, smaller-step focus and **I'm drifting** return flow remain available. A readable server does not continuously wake an AI, listen to the user or detect drift. Proactive outreach needs a separate explicit setup.

Shared login protects account data; a read-only key protects the AI route. External-AI JSON and CSV reachability on the published address was verified using a temporary synthetic read-only key without a browser login; the temporary keys were revoked afterward. Other sharing/domain changes can still introduce a gate. Hosting, sync and a recovery point do not replace off-device backups or existing critical calendar/reminder safeguards.
