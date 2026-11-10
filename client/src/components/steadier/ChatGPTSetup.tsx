import { useState } from "react";
import { Bot, ClipboardCopy, Square, Volume2 } from "lucide-react";
import { copyPrivate, downloadPrivate } from "../../lib/cloudApi";
import {
  COMPASS_MCP_URL,
  COMPASS_PLANNING_BRIEF,
} from "../../../../shared/compassConnection";

type Voice = {
  speechSupported: boolean;
  speaking: boolean;
  read: (text: string) => void;
  stopSpeaking: () => void;
};

export default function ChatGPTSetup({ voice }: { voice?: Voice }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const steps = `Connect ChatGPT to Steadier My Life. Use ChatGPT on the web. Open Plugins, choose the plus button, then Add custom MCP server. In the legacy Apps setup, use Settings or Workspace settings, then Apps and Create. Enter the name Steadier My Life and this public HTTPS MCP endpoint: ${COMPASS_MCP_URL}. Choose OAuth and approve the risk notice; do not paste a key or secret. Sign in to Steadier with the Manus account that owns your shared personal records. For full read and changes, ChatGPT currently requires a Business or Enterprise/Edu workspace with its custom-MCP permissions. On Business only workspace admins or owners can create and publish. On Enterprise/Edu an authorized developer can create and test, but only an admin or owner can publish. ChatGPT Pro custom MCP is limited to read/fetch, so it cannot have write parity. When Steadier asks how to label the connection, select ChatGPT only if you started and recognize this connection in ChatGPT; otherwise leave the safe generic MCP connector label. Client names are not independently verified. Continue to ChatGPT, enable the app for a conversation, and ask it to read your saved context and confirm the planning date and server revision before planning. Every applied change is backed up first and attributed to the label you selected. Suggestions stay unconfirmed until you confirm them in Steadier. Deletions are only pending requests that you confirm or keep here. Only you can restore backups. The connector reads the saved server workspace, not unsynced drafts, and does not monitor you in the background. Revoke access in Steadier under Server and Compass. OAuth access can renew while the connection remains active. For workspace-published apps, a later tool update may need an admin to refresh and republish its approved tool snapshot.`;

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

  return (
    <section
      className="settings-section claude-setup"
      aria-labelledby="chatgpt-setup-title"
    >
      <div className="section-heading">
        <h2 id="chatgpt-setup-title">
          <Bot size={21} /> Connect ChatGPT to My Life
        </h2>
        <span className="badge">Private MCP · OAuth</span>
      </div>
      <p>
        ChatGPT can use the same owner-approved Compass tools as Claude. Nothing
        is available until you sign in and approve the connection in Steadier.
        Read and changes remains optional.
      </p>
      <label className="field">
        ChatGPT MCP server URL
        <input
          readOnly
          value={COMPASS_MCP_URL}
          aria-label="ChatGPT MCP server URL"
        />
      </label>
      <div className="backup-actions">
        <button
          className="button secondary"
          onClick={() =>
            void copy(
              COMPASS_MCP_URL,
              "ChatGPT connector URL copied. It contains no key."
            )
          }
        >
          <ClipboardCopy size={16} /> Copy ChatGPT connector URL
        </button>
        <button
          className="button secondary"
          onClick={() =>
            downloadPrivate(steps, "steadier-chatgpt-setup.txt", "text/plain")
          }
        >
          Download ChatGPT setup steps
        </button>
        {voice?.speechSupported && (
          <button
            className="button secondary"
            onClick={() =>
              voice.speaking ? voice.stopSpeaking() : voice.read(steps)
            }
          >
            {voice.speaking ? <Square size={15} /> : <Volume2 size={16} />}
            {voice.speaking ? "Stop reading" : "Read setup aloud"}
          </button>
        )}
      </div>
      <ol className="claude-steps">
        <li>
          In ChatGPT on the web, open{" "}
          <strong>Plugins → + → Add custom MCP server</strong>. For the legacy
          Apps flow, use Settings or Workspace settings → Apps → Create. Full
          read and changes currently requires a Business or Enterprise/Edu
          workspace; Pro custom MCP is read/fetch only.
        </li>
        <li>
          Name it <strong>Steadier My Life</strong>, paste the URL above, choose
          OAuth sign-in, and accept the risk notice. Do not use an API key or
          paste a secret into chat.
        </li>
        <li>
          Sign in to Steadier with the Manus account that owns your saved shared
          space. Review the account and choose read-only or read and changes.
          When choosing an audit label, select ChatGPT only if you initiated and
          recognize this connection; otherwise keep the generic MCP label.
          Steadier cannot independently verify the requesting app's brand.
          Business workspaces require an admin or owner to create and publish;
          Enterprise/Edu workspaces may authorize developers to test, but an
          admin or owner must publish.
        </li>
        <li>
          Back in ChatGPT, enable the app in a conversation. Ask it to read your
          current context and confirm the planning date and server revision.
        </li>
      </ol>
      <p className="small muted">
        Custom MCP setup is controlled by OpenAI and may require ChatGPT web, an
        eligible plan, and workspace-admin approval. If the option is missing in
        the Android app, try ChatGPT on the web. See{" "}
        <a
          href="https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt"
          target="_blank"
          rel="noopener noreferrer"
        >
          OpenAI’s current setup guide
        </a>
        . The connector reads saved server data only; it cannot see unsynced
        changes or monitor focus. Workspace-published apps may need an admin to
        refresh and republish after tool updates. Access can be revoked under
        Server & Compass.
      </p>
      <details className="detail-section">
        <summary>Help ChatGPT keep me on my chosen direction</summary>
        <p>
          This optional planning brief is a prompt, not a background monitor.
        </p>
        <textarea
          className="claude-brief"
          readOnly
          rows={8}
          value={COMPASS_PLANNING_BRIEF}
          aria-label="ChatGPT Compass planning brief"
        />
        <button
          className="button secondary"
          onClick={() =>
            void copy(
              COMPASS_PLANNING_BRIEF,
              "Compass planning brief copied. It contains no credentials."
            )
          }
        >
          <ClipboardCopy size={16} /> Copy planning brief
        </button>
      </details>
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
