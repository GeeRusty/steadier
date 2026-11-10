import { Cloud, RefreshCw, Volume2, Square, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { useSharedWorkspace } from "../../hooks/useSharedWorkspace";
import { startLogin } from "../../const";

export default function SharedStartupGate({
  store,
  onRead,
  onStopReading,
}: {
  store: ReturnType<typeof useSharedWorkspace>;
  onRead: (text: string) => void;
  onStopReading: () => void;
}) {
  const c = store.cloud;
  const [loginError, setLoginError] = useState("");
  const notice = c.startupNotice || "Opening your shared personal space.";
  const help = `${notice} Your original browser jobs have not been moved or deleted. Sign in with the same Manus account to reopen the saved server collection. You can retry the shared connection, or deliberately open the original browser space. Sample data stays separate. You do not need to copy your backup again.`;

  return (
    <main
      className="claude-consent-page"
      id="main-content"
      aria-labelledby="startup-heading"
    >
      <section className="claude-consent-card" aria-busy={c.checking}>
        <span className="eyebrow">MY LIFE · YOUR SHARED PERSONAL SPACE</span>
        <h1 id="startup-heading">
          <Cloud size={32} aria-hidden="true" /> One home for your jobs.
        </h1>
        <p role="status" aria-live="polite">
          {notice}
        </p>
        <p className="small muted">
          We check your sign-in before opening private server records. Nothing
          in your original browser collection is uploaded automatically.
        </p>
        {loginError && (
          <p className="error" role="alert">
            {loginError}
          </p>
        )}
        <div className="backup-actions">
          {!c.user && (
            <button
              className="button primary"
              disabled={c.checking}
              onClick={() => {
                try {
                  onStopReading();
                  startLogin();
                } catch (error) {
                  setLoginError(
                    error instanceof Error
                      ? error.message
                      : "Sign-in could not start."
                  );
                }
              }}
            >
              Sign in with Manus
            </button>
          )}
          <button
            className={`button ${c.user ? "primary" : "secondary"}`}
            disabled={c.checking}
            onClick={() => {
              setLoginError("");
              void c.connect();
            }}
          >
            <RefreshCw size={16} aria-hidden="true" />{" "}
            {c.checking ? "Opening shared space…" : "Retry shared space"}
          </button>
        </div>
        <p className="small muted">
          <ShieldCheck size={15} aria-hidden="true" /> No automatic backup
          replacement or focus takeover.
        </p>
        <div className="backup-actions">
          <button className="button secondary" onClick={() => onRead(help)}>
            <Volume2 size={16} aria-hidden="true" /> Read opening help aloud
          </button>
          <button className="button secondary" onClick={onStopReading}>
            <Square size={14} aria-hidden="true" /> Stop reading
          </button>
        </div>
        <div className="backup-actions">
          <button
            className="button secondary"
            onClick={() => {
              onStopReading();
              c.disconnect();
            }}
          >
            Open original browser space
          </button>
          <button
            className="text-button"
            onClick={() => {
              onStopReading();
              store.switchKind("demo");
            }}
          >
            View sample lab instead
          </button>
        </div>
        <p className="small muted">
          Choosing the original browser space or sample lab is remembered too.
          Neither is your shared server collection.
        </p>
      </section>
    </main>
  );
}
