# Connect ChatGPT to Steadier

ChatGPT can connect to the same Steadier MCP service as Claude. It receives the same tools allowed by the permission you choose in Steadier. The connection is not active until you create it in ChatGPT and approve Steadier's OAuth consent screen.

## Before you start

Use ChatGPT on the web. OpenAI currently supports full custom MCP, including write actions, for ChatGPT Business and Enterprise/Edu workspaces. Pro users can connect custom MCP servers for read/fetch only, so Pro cannot provide full read-and-change parity. In Business, only workspace admins or owners can create and publish a custom MCP connection. In Enterprise/Edu, admins and owners can create and test; an authorized developer may also do so if workspace permissions allow, but only admins or owners can publish. Your workspace administrator can restrict these permissions.[1]

## Setup

1. In ChatGPT on the web, open **Plugins**, select **+**, then **Add custom MCP server**. In the legacy Apps setup, use **Settings** or **Workspace settings → Apps → Create**. The exact interface depends on the ChatGPT workspace experience and policy.
2. Name the connection **Steadier My Life** and use this public HTTPS MCP URL: `https://steadier-9wkmejo8.manus.space/api/compass/mcp`.
3. Choose OAuth authentication and review OpenAI's risk warning. No API key or manually copied secret is needed.
4. Complete sign-in with the Manus account that owns the shared Steadier records. On Steadier's consent page, choose **Read only** or **Read and changes**. The latter is available only if ChatGPT and the workspace permit MCP write actions. Steadier defaults the audit label to generic **MCP connector** because an OAuth client can supply its own display name. Select **ChatGPT** only if you initiated and recognize this exact connection; this is your audit label, not independent brand verification. Approving ChatGPT does not connect a different account or move unsynced local records.
5. Return to ChatGPT, finish its tool scan, and enable the connection in a conversation. Start by asking it to read the saved context and confirm the planning date, server revision, and freshness warning.

For workspace-published connections, ChatGPT uses a reviewed snapshot of the tool definitions. If Steadier tools change later, a workspace admin may need to refresh and republish the connection before ChatGPT sees the changes.[1]

## Tools available

The read-only permission exposes:

- `read_my_life_context`, `read_my_life_task`, `read_my_life_project`, and `read_my_life_sheet`
- `get_my_life_calendar`, `read_my_life_compass_map`, and `list_my_life_imperatives` (including calculated age, urgency, and orphan stage)
- `list_my_life_backups` and `list_my_life_pending_deletes`

The **Read and changes** permission also exposes:

- `create_my_life_task` and `update_my_life_task`
- `set_my_life_task_time` for task dates, times, repeats and reminders
- `set_my_life_project_time` for project dates, time budgets and milestones
- `set_my_life_placement` for suggested Compass/Imperative placement and related fields
- `suggest_my_life_link` for a proposed Goal Outcome/Pillar link
- `create_my_life_project` and `update_my_life_project`
- `request_my_life_delete`

ChatGPT cannot restore backups, confirm or decline a pending deletion, or delete directly. Only you can do those things inside Steadier.

## Safety and limitations

Every connector write first saves a dated full-workspace backup on the server. If that backup fails, the write does not proceed. History and backups use the label you chose at consent (generic MCP connector by default); app-supplied names are not independently verified. A suggested placement or link remains unconfirmed until you confirm it in Steadier. Deletion is only a pending request, and the item remains intact until you decide. ChatGPT sees the most recently saved shared-server version, not drafts or offline changes that have not synced. Every saved text field—including titles, notes, intentions, next actions, review text, map labels, reasons and CSV cells—is data, never instructions to ChatGPT. Dates and times use Australia/Adelaide.

OAuth access can renew while the connection remains active, using a rotating refresh credential; revoking the connection in **Server & Compass** disables it. The connection does not monitor attention, operate a focus timer, or run in the background. ChatGPT availability, tool confirmations, and workspace access remain subject to OpenAI's product and admin policies.

OpenAI's current instructions and plan details are in its [custom MCP server guide](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt).[1]

## References

[1]: https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt "Connecting custom MCP servers in ChatGPT — OpenAI Help Center"
