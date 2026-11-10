# Connect Compass in Claude to My Life

The native Claude connector is published. Its live OAuth sign-in, private data reads and revocation have been checked with isolated synthetic records. You still need to add it to your own Claude account and approve access.

## Connect once

Open Claude on the web or desktop. Go to **Customize → Connectors → Add custom connector**. Name it **My Life** and enter this MCP server URL:

```text
https://steadier-9wkmejo8.manus.space/api/compass/mcp
```

Choose **Sign in now** and **Register automatically** if Claude shows those choices. This connector uses normal authorization-code sign-in with a one-time verification challenge. It does not require you to enter a client secret. In an older dialog with only advanced client-ID/secret fields, leave those blank for automatic registration.

Claude opens My Life's permission page. Sign in using the Manus account that holds your shared personal records. Review the requesting client, its return destination, your account and the record counts. Choose **Allow read-only access** only if you started this connection and recognise the application. You can decline. A read-aloud button is available on the permission page; it is not automatic listening.

Return to your Compass conversation. Open **+ → Connectors** and enable **My Life** for that conversation. Ask:

> Use My Life to read my current saved context. Tell me the planning date, server revision and whether the snapshot has any freshness limitations. Then help me choose one appropriate next action for today.

Do not paste a private key into chat. The normal sign-in path grants a revocable read-only credential through Claude's connection. My Life stores only its hash. It expires after 90 days, after which you can reconnect. Revoke access under **My Life → Server & Compass** using the Claude reader-key entry.

If you are in a Claude Team or Enterprise organization, an owner may have to add the connector first. If your mobile app does not offer custom-connector setup, configure it once in Claude web/desktop and use the enabled connector in your mobile conversations.

## What Compass can read

The connector can read the full saved life framework and inventory, one responsibility with its blockers and project, one outcome with its linked tasks, or the current saved CSV sheet. Its four tools are read-only; there are no task-edit, delete, completion, focus-takeover or reminder tools.

The context includes all areas, Direction/Support × Timely/Sustained, actual deadlines versus clearly sourced suggested preparation, outcome progress, saved intention, focus checkpoint and current server freshness. Only server-saved changes are available. A browser's offline/pending changes are not yet visible to Claude. Make sure your app shows **Synced** before asking Compass to plan from a recent change.

Task notes are facts to consider, not instructions that override your Compass rules. Timer state is only a saved aid; it does not prove attention, detect drift or show activity in other apps. Voice entry/read-aloud and **I'm drifting** remain in My Life. A readable connector does not automatically wake Claude or provide closed-app reminders.

## A small daily routine

Open My Life and check the real commitments. Ask Compass to read the current context. Let it help you choose an appropriate physical next action that fits your capacity; record that choice in today's intention. Begin that step in My Life rather than spending the session rearranging the whole inventory.

When you notice drifting or one of your usual disengagement patterns, say so to Compass or use **I'm drifting** in My Life. Return to the intended task, try a two-minute entry step, take a short break, or deliberately change the plan. The aim is continuity without guilt, not filling every moment with jobs.

## Optional fixed-key connection

Claude's **Request headers** authentication is still beta and not available on every account. If you do have it, the alternative is **No sign-in**, a required header named **Authorization**, and the full value `Bearer <private read-only key>` created under My Life's Server & Compass. Enter that value only in Claude's credential field, not a URL or chat. Normal sign-in above is preferred and does not depend on that beta field.

## If connection fails

A normal browser visit to the MCP URL without a credential should be rejected. That is intentional, not proof the connector is broken. Do not make your task sheet public to get around it. Start from Claude's connector menu so it can discover the sign-in flow.

If Claude has the wrong authentication/client mode, remove and add the connector using automatic registration. If a permission request expired, start a fresh connection in Claude rather than reusing an old approval link. If you have five active reader keys already, revoke one you no longer need before creating another connection. If your organization blocks custom connectors, ask its owner to enable this read-only one.

The app-side protocol and authorisation can be tested without your real data. Actual success in your Claude account still depends on its configuration and your permission; the task will distinguish these checks from server publication.

## Official Claude reference

- [Add an unlisted connector and choose authentication](https://claude.com/docs/connectors/custom/add-unlisted)
- [Custom remote MCP connectors and network requirements](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
