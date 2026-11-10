import { useEffect, useState } from "react";
import { ShieldCheck, Volume2, Square } from "lucide-react";
import { startLogin } from "../../const";
import { privateJSON, privateOwnerJSON } from "../../lib/cloudApi";
import type { CloudUser, ConnectorActor } from "../../../../shared/cloud";
import { formatAdelaide } from "../../../../shared/time";
import {
  COMPASS_LOGIN_RETURN_COOKIE,
  COMPASS_PUBLIC_ORIGIN,
  type CompassConsentView,
  type CompassConsentDecision,
} from "../../../../shared/compassConnection";

export default function ClaudeConsent({
  ticket,
  onRead,
  onStopReading,
}: {
  ticket: string;
  onRead: (text: string) => void;
  onStopReading: () => void;
}) {
  const [user, setUser] = useState<CloudUser | null>(null);
  const [request, setRequest] = useState<CompassConsentView | null>(null);
  const [connectorActor, setConnectorActor] =
    useState<ConnectorActor>("connector");
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const isEmbedded = window.self !== window.top;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setChecking(true);
    setError("");
    setRequest(null);
    setConnectorActor("connector");
    setUser(null);
    setSignedOut(false);
    void (async () => {
      try {
        const session = await privateJSON<{ user: CloudUser }>(
          "/api/steadier/session",
          { signal: controller.signal }
        );
        const detail = await privateOwnerJSON<CompassConsentView>(
          session.user.id,
          `/api/compass/oauth/requests/${encodeURIComponent(ticket)}`,
          { signal: controller.signal }
        );
        if (active) {
          setUser(session.user);
          setRequest(detail);
        }
      } catch (e) {
        if (!active || controller.signal.aborted) return;
        const message =
          e instanceof Error
            ? e.message
            : "Permission request could not be checked.";
        if (message.includes("Sign in")) setSignedOut(true);
        else setError(message);
      } finally {
        if (active) setChecking(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [ticket]);

  async function decide(approve: boolean, access: "read" | "write" = "read") {
    if (!user || !request || busy) return;
    if (approve && isEmbedded) {
      setError(
        "Open this permission page in a full browser window before approving."
      );
      return;
    }
    setBusy(true);
    setError("");
    onStopReading();
    try {
      const result = await privateOwnerJSON<CompassConsentDecision>(
        user.id,
        `/api/compass/oauth/requests/${encodeURIComponent(ticket)}/decision`,
        {
          method: "POST",
          body: JSON.stringify({ approve, access, connectorActor }),
        }
      );
      const destination = new URL(result.redirectUrl);
      if (
        destination.protocol !== "https:" ||
        destination.origin !== request.redirectOrigin
      )
        throw new Error(
          "The return address could not be verified. No redirect was followed."
        );
      document.cookie = `${COMPASS_LOGIN_RETURN_COOKIE}=; Path=/; Max-Age=0; SameSite=None; Secure`;
      window.location.assign(destination.href);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Permission could not be confirmed. Retry from the app you connected."
      );
      setBusy(false);
    }
  }

  const canOfferChanges =
    request?.requestedScope === "steadier:read steadier:write";
  const connector =
    connectorActor === "chatgpt"
      ? "ChatGPT"
      : connectorActor === "claude"
        ? "Claude"
        : "MCP connector";
  const renewable = request?.offlineAccess
    ? "An expiring access token can renew through a one-use rotating credential until you revoke this connection; the refresh credential expires after ninety days without use."
    : "Access expires in ninety days.";
  const permission = `Allow ${request?.clientName || "this AI connector"} into the saved My Life collection for ${user?.name || "this signed-in account"}? Reading includes responsibilities, private notes, projects, outcomes, matrix, dates and saved intention across all areas. You choose one of two levels. Read only: ${connector} can read but never change anything. Read and changes: ${connector} can also add and update tasks and projects when you ask it to. Before every change Steadier saves a full dated backup on the server, and if that backup fails nothing changes. Every change appears in history labelled ${connector}, with the Adelaide time. This label is your selection; Steadier cannot independently verify the provider's identity. ${connector} can never delete directly: it can only mark an item pending delete for you to confirm or keep here. It can list backups but only you can restore one. It cannot run a timer, monitor you, or listen to your microphone. ${renewable} You can revoke access under Server and Compass.`;

  return (
    <main className="claude-consent-page">
      <section
        className="settings-section claude-consent-card"
        aria-labelledby="claude-permission-title"
      >
        <div className="eyebrow">MY LIFE · PRIVATE CONNECTOR ACCESS</div>
        <h1 id="claude-permission-title">
          <ShieldCheck size={28} /> Your permission, not a public link.
        </h1>
        <p>
          Connect Compass to your actual saved context, so it can help you plan
          and return to your chosen direction.
        </p>
        {isEmbedded && (
          <div className="notice" role="alert">
            <strong>Approve only in a full browser window.</strong>
            <p>
              Permission cannot be granted inside another page. This protects
              you from hidden or misleading approval controls.
            </p>
            <a
              className="button secondary"
              href={`${COMPASS_PUBLIC_ORIGIN}/?compass_oauth=${encodeURIComponent(ticket)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open secure permission page
            </a>
          </div>
        )}
        {checking && (
          <p role="status">
            Checking your sign-in and this permission request…
          </p>
        )}
        {signedOut && (
          <>
            <p>
              First sign in to My Life using the Manus account that holds your
              server records. You will return here to review permission before
              anything is granted.
            </p>
            <button
              className="button primary"
              onClick={() => {
                try {
                  document.cookie = `${COMPASS_LOGIN_RETURN_COOKIE}=${encodeURIComponent(ticket)}; Path=/; Max-Age=600; SameSite=None; Secure`;
                  startLogin();
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Sign-in is unavailable."
                  );
                }
              }}
            >
              Sign in with Manus
            </button>
            <div className="backup-actions">
              <button
                className="button secondary"
                onClick={() =>
                  onRead(
                    "First sign in to My Life using the Manus account that holds your server records. You will return here to review permission. Nothing is shared until you explicitly choose read only or read and changes. If sign-in settings cannot load, go online and reload the page. You can return to My Life without granting access."
                  )
                }
              >
                <Volume2 size={16} /> Read sign-in help aloud
              </button>
              <button className="button secondary" onClick={onStopReading}>
                <Square size={15} /> Stop reading
              </button>
            </div>
          </>
        )}
        {request && user && (
          <>
            <div className="notice">
              <strong>{request.clientName}</strong>
              <p className="small">
                Client names are supplied by the requesting application. Return
                destination: <code>{request.redirectOrigin}</code>. Steadier
                cannot verify the provider's brand. Use a ChatGPT or Claude
                audit label only if you initiated and recognize this exact
                connection; otherwise leave it as the generic MCP connector.
              </p>
            </div>
            <fieldset className="consent-levels">
              <legend>How should Steadier label this connection?</legend>
              <label>
                <input
                  type="radio"
                  name="compass-audit-label"
                  value="connector"
                  checked={connectorActor === "connector"}
                  onChange={() => setConnectorActor("connector")}
                />
                MCP connector (default)
              </label>
              <label>
                <input
                  type="radio"
                  name="compass-audit-label"
                  value="chatgpt"
                  checked={connectorActor === "chatgpt"}
                  onChange={() => setConnectorActor("chatgpt")}
                />
                ChatGPT (I started and recognize this connection)
              </label>
              <label>
                <input
                  type="radio"
                  name="compass-audit-label"
                  value="claude"
                  checked={connectorActor === "claude"}
                  onChange={() => setConnectorActor("claude")}
                />
                Claude (I started and recognize this connection)
              </label>
            </fieldset>
            <p>
              <strong>
                Signed in{user.name ? ` as ${user.name}` : " to your account"}.
              </strong>{" "}
              This server collection holds {request.taskCount} responsibilities
              and {request.projectCount} projects.
            </p>
            <p>{permission}</p>
            <p className="small muted">
              Only the saved server version is available; offline or pending
              changes are not included. Read access does not wake an assistant
              in the background or prove whether you are focused.
            </p>
            <div className="backup-actions">
              <button
                className="button secondary"
                onClick={() => onRead(permission)}
              >
                <Volume2 size={16} /> Read permission aloud
              </button>
              <button className="button secondary" onClick={onStopReading}>
                <Square size={15} /> Stop reading
              </button>
            </div>
            <ul className="small consent-levels">
              <li>
                <strong>Read only</strong> — The connected app reads your saved
                context and never changes it.
              </li>
              <li>
                <strong>Read and changes</strong> — The connected app can also
                add and update tasks and projects when you ask. A full server
                backup is taken first; each change is labelled with the app name
                in history; deletes are only requests you confirm here; only you
                can restore a backup.
              </li>
            </ul>
            <div className="backup-actions">
              {canOfferChanges && (
                <button
                  className="button primary"
                  disabled={busy || isEmbedded}
                  onClick={() => void decide(true, "write")}
                >
                  {busy ? "Confirming…" : "Allow read and changes"}
                </button>
              )}
              <button
                className={
                  canOfferChanges ? "button secondary" : "button primary"
                }
                disabled={busy || isEmbedded}
                onClick={() => void decide(true, "read")}
              >
                {busy ? "Confirming…" : "Allow read only"}
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void decide(false)}
              >
                Do not allow
              </button>
            </div>
            <p className="small muted">
              This request expires {formatAdelaide(request.expiresAt)}{" "}
              (Adelaide). Approve only if you started this connection and
              recognise the application.
            </p>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!checking && !signedOut && !request && (
          <p>
            Return to the app you connected and start the connection again if
            this request expired or was already used.
          </p>
        )}
        <button
          className="text-button"
          onClick={() => {
            onStopReading();
            window.location.assign("/");
          }}
        >
          Return to My Life without granting access
        </button>
      </section>
    </main>
  );
}
