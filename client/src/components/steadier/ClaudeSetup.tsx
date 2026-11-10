import { useState } from "react";
import { ClipboardCopy, Compass } from "lucide-react";
import { copyPrivate, downloadPrivate } from "../../lib/cloudApi";
import {
  COMPASS_MCP_URL,
  COMPASS_PLANNING_BRIEF,
} from "../../../../shared/compassConnection";

export default function ClaudeSetup() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function copy(text: string, success: string) {
    try {
      await copyPrivate(text);
      setMessage(success);
      setError("");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Copy unavailable. Select the text manually."
      );
    }
  }
  const guide = `# Connect Claude Compass to My Life\n\nMCP server URL: ${COMPASS_MCP_URL}\n\n1. Open Claude on the web or desktop and go to Customize > Connectors > Add custom connector. Name it My Life.\n2. Paste the MCP URL. Choose Sign in now and Register automatically if these options are shown. Do not enter a client secret; this is public-client PKCE registration.\n3. Follow the browser sign-in to My Life using the Manus account that holds your server records. Review the client and read-only scope, then approve.\n4. Back in your Compass conversation, use + > Connectors to enable My Life. Ask Claude to call read_my_life_context and state the saved server revision and planning date before planning.\n5. Add the planning brief below to your Compass project instructions if it fits your system.\n\nNo key needs to be pasted into chat. Access reads all saved areas, including private notes, but cannot edit records. You can revoke the Claude key in My Life > Server & Compass. Grants expire after 90 days; reconnect after expiry. Organization accounts may require an owner to add the connector. On mobile, use the web/desktop setup if the custom connector menu is unavailable.\n\nOptional fixed-key alternative, only if Claude shows Request headers: choose No sign-in, add required Authorization header with the full value Bearer <your private reader key>, and store it only in that credential field. Headers are beta and not available on every account.\n\nThe connector reads current saved server data, not unsynced browser drafts. It does not listen continuously, see other apps or trigger automatic check-ins. Read-only tools have no write authority.\n\n## Compass planning brief\n\n${COMPASS_PLANNING_BRIEF}\n`;
  return (
    <section
      className="settings-section claude-setup"
      aria-labelledby="claude-setup-title"
    >
      <div className="section-heading">
        <h2 id="claude-setup-title">
          <Compass size={21} /> Connect your Claude Compass
        </h2>
        <span className="badge">Read-only MCP</span>
      </div>
      <p>
        Use Claude’s native connector to read current context before planning.
        Normal sign-in and explicit permission mean you do not have to share a
        key in chat.
      </p>
      <label className="field">
        Claude MCP server URL
        <input
          readOnly
          value={COMPASS_MCP_URL}
          aria-label="Claude MCP server URL"
        />
      </label>
      <div className="backup-actions">
        <button
          className="button secondary"
          onClick={() =>
            void copy(
              COMPASS_MCP_URL,
              "Claude connector URL copied. It contains no key."
            )
          }
        >
          <ClipboardCopy size={16} /> Copy Claude connector URL
        </button>
        <button
          className="button secondary"
          onClick={() =>
            downloadPrivate(guide, "my-life-claude-setup.md", "text/markdown")
          }
        >
          Download Claude setup guide
        </button>
      </div>
      <ol className="claude-steps">
        <li>
          In Claude web/desktop, open{" "}
          <strong>Customize → Connectors → Add custom connector</strong>. Name
          it My Life and paste this URL.
        </li>
        <li>
          Choose <strong>Sign in now</strong> and{" "}
          <strong>Register automatically</strong> when shown. Leave client
          ID/secret fields empty if your older layout uses automatic
          registration.
        </li>
        <li>
          Sign into My Life with the right Manus account and approve{" "}
          <strong>read-only</strong> access. Review the account and client
          first.
        </li>
        <li>
          Enable My Life in the Compass chat using{" "}
          <strong>+ → Connectors</strong>. Ask it to read your current context
          and confirm the planning date and server revision.
        </li>
      </ol>
      <p className="small muted">
        Your Claude organization may require an owner to add connectors. If
        mobile does not show custom setup, use Claude web/desktop once. The
        endpoint must be on the published app; Preview alone is not a long-term
        connector address.
      </p>
      <details className="detail-section">
        <summary>
          Optional private-key setup if Claude shows Request headers
        </summary>
        <p>
          Choose No sign-in, then add a required <code>Authorization</code>{" "}
          header. Its complete value is{" "}
          <code>Bearer &lt;private read-only key&gt;</code>. Claude stores that
          credential privately. This beta option is not available on every
          account; normal sign-in above is preferred.
        </p>
      </details>
      <details className="detail-section">
        <summary>Help Compass keep me on my chosen direction</summary>
        <p>
          Copy this into your existing Compass instructions if it fits. It asks
          for an appropriate physical next step, not just an attractive task,
          and helps re-entry when you tell it you are drifting.
        </p>
        <textarea
          className="claude-brief"
          readOnly
          rows={8}
          value={COMPASS_PLANNING_BRIEF}
          aria-label="Compass daily focus brief"
        />
        <button
          className="button secondary"
          onClick={() =>
            void copy(
              COMPASS_PLANNING_BRIEF,
              "Compass planning brief copied. No credentials included."
            )
          }
        >
          Copy Compass planning brief
        </button>
      </details>
      <p className="small muted">
        Voice capture/read-aloud and the saved intention/“I’m drifting” return
        flow stay in My Life. A connector is not always-on listening or
        background monitoring. Unsynced offline changes are not visible to
        Claude. Revoke access using the Claude reader-key entry below; after 90
        days, reconnect.
      </p>
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
