import ClaudeSetup from "./ClaudeSetup";
import ChatGPTSetup from "./ChatGPTSetup";
import ClaudeChangesPanel from "./ClaudeChangesPanel";
import { formatAdelaide } from "../../../../shared/time";
import { useEffect, useRef, useState } from "react";
import {
  Cloud,
  CloudOff,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Upload,
  Download,
  ClipboardCopy,
} from "lucide-react";
import type { useSharedWorkspace } from "../../hooks/useSharedWorkspace";
import type { CompassKeyInfo } from "../../../../shared/cloud";
import { startLogin } from "../../const";
import { exportBackup } from "../../domain/transfer";
import {
  copyPrivate,
  downloadPrivate,
  privateOwnerJSON,
} from "../../lib/cloudApi";

type Store = ReturnType<typeof useSharedWorkspace>;

function openAPISchema(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Steadier private Compass context",
      version: "1.0.0",
      description:
        "Read the latest saved personal responsibilities before planning. No write tools. Unsynced offline edits are not included.",
    },
    servers: [{ url: origin }],
    security: [{ compassKey: [] }],
    components: {
      securitySchemes: {
        compassKey: {
          type: "http",
          scheme: "bearer",
          description:
            "Private expiring read-only key issued in Steadier. Never put it in a URL.",
        },
      },
    },
    paths: {
      "/api/compass/context": {
        get: {
          operationId: "readSteadierContext",
          summary:
            "Read current saved load, all areas, outcomes, dates, intention and freshness",
          responses: {
            "200": {
              description:
                "Authenticated personal context; check freshness and explicit versus suggested dates.",
              content: {
                "application/json": {
                  schema: { type: "object", additionalProperties: true },
                },
              },
            },
            "401": { description: "Key missing, expired or revoked." },
          },
        },
      },
      "/api/compass/sheet.csv": {
        get: {
          operationId: "readSteadierSheet",
          summary:
            "Read a sheet-style CSV of all saved responsibilities and their life framing",
          responses: {
            "200": {
              description:
                "Private UTF-8 sheet generated from the latest server workspace.",
              content: { "text/csv": { schema: { type: "string" } } },
            },
            "401": { description: "Key missing, expired or revoked." },
          },
        },
      },
    },
  };
}

export default function SharedDataPanel({
  store,
  onSheet,
  voice,
}: {
  store: Store;
  onSheet: () => void;
  voice?: React.ComponentProps<typeof ClaudeChangesPanel>["voice"];
}) {
  const c = store.cloud;
  const ownedJSON = <T,>(path: string, options: RequestInit = {}) =>
    privateOwnerJSON<T>(c.user?.id || 0, path, options);
  const accountRef = useRef(c.user?.id);
  accountRef.current = c.user?.id;
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<
    "transfer" | "server" | "local" | null
  >(null);
  const [keys, setKeys] = useState<CompassKeyInfo[]>([]);
  const [keyLabel, setKeyLabel] = useState("Compass");
  const [newToken, setNewToken] = useState("");
  const [reveal, setReveal] = useState(false);
  const [revokeId, setRevokeId] = useState<number | null>(null);
  const [consent, setConsent] = useState(false);
  const [tokenOwner, setTokenOwner] = useState<number | null>(null);
  const origin = window.location.origin;
  const emptyServer =
    !store.workspace.tasks.length && !store.workspace.projects.length;

  useEffect(() => {
    let alive = true;
    setNewToken("");
    setError("");
    setKeys([]);
    setConsent(false);
    setConfirm(null);
    if (c.user) {
      ownedJSON<{ keys: CompassKeyInfo[] }>("/api/steadier/compass-keys")
        .then(v => {
          if (alive && accountRef.current === c.user?.id) setKeys(v.keys);
        })
        .catch(e => {
          if (alive) setError(e.message);
        });
    }
    return () => {
      alive = false;
    };
  }, [c.user?.id]);

  async function run(
    action: () => boolean | Promise<boolean>,
    success: string
  ) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (await action()) setMessage(success);
      else
        setError(
          "The operation did not complete. Check the sync message; your original browser records remain intact."
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation unavailable.");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }
  async function reloadKeys() {
    const owner = accountRef.current;
    const v = await ownedJSON<{ keys: CompassKeyInfo[] }>(
      "/api/steadier/compass-keys"
    );
    if (accountRef.current === owner) setKeys(v.keys);
  }

  return (
    <div className="shared-data-view">
      <div className="view-heading">
        <span className="eyebrow">ONE PRIVATE HOME FOR YOUR RECORDS</span>
        <h1>Server & Compass</h1>
        <p>
          The same personal collection on your phone and laptop. Compass reads
          the saved facts; you choose the direction.
        </p>
      </div>
      <section className="settings-section">
        <div className="section-heading">
          <h2>
            <Cloud size={21} /> Your shared personal space
          </h2>
          <span className="badge">{c.active ? c.status : "Browser only"}</span>
        </div>
        <p>
          {c.user
            ? `Signed in${c.user.name ? ` as ${c.user.name}` : ""}. Use this same Manus account on your other device.`
            : "Sign in with Manus to connect your private server collection. Sample and original browser records are not uploaded automatically."}
        </p>
        {c.active && (
          <p className="small muted">
            Server revision {c.revision}. Last confirmed server update:{" "}
            {c.lastSyncedAt
              ? `${formatAdelaide(c.lastSyncedAt)} (Adelaide)`
              : "No saved changes yet"}
            .{" "}
            {c.pending
              ? "This browser has changes not yet confirmed on the server; Compass cannot see them yet."
              : "Compass can retrieve the saved server version, not other-device unsynced drafts."}
          </p>
        )}
        {c.error && (
          <p className="error" role="alert">
            {c.error}
          </p>
        )}
        <div className="backup-actions">
          {!c.user && (
            <button
              className="button primary"
              disabled={c.checking || busy}
              onClick={() => {
                try {
                  startLogin();
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Login could not start."
                  );
                }
              }}
            >
              Sign in with Manus
            </button>
          )}
          {!c.active && (
            <button
              className="button secondary"
              disabled={busy || c.checking}
              onClick={() =>
                void run(
                  c.connect,
                  "Shared personal space loaded. No original browser tasks were uploaded."
                )
              }
            >
              <Cloud size={16} />
              {c.user ? "Use shared personal space" : "Check connection"}
            </button>
          )}
          {c.active && (
            <>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void run(
                    c.retry,
                    "Connection checked; review the status above."
                  )
                }
              >
                <RefreshCw size={16} />
                Refresh / retry sync
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  if (c.pending)
                    downloadPrivate(
                      exportBackup(store.workspace),
                      "steadier-pending-browser-backup.json"
                    );
                  c.disconnect();
                  setMessage(
                    "Original browser personal space opened. Shared records were not deleted."
                  );
                }}
              >
                <CloudOff size={16} />
                View original browser space
              </button>
              <button className="button secondary" onClick={onSheet}>
                View server sheet
              </button>
            </>
          )}
        </div>
        <p className="small muted">
          A shared account is not a shared public link. Sign-in protects your
          collection. Browser cookie restrictions may require opening the
          published app in a full browser.
        </p>
      </section>

      {c.active && (c.localPersonal || c.localPersonalProtected) && (
        <section className="settings-section">
          <div className="section-heading">
            <h2>
              <Upload size={21} /> Bring over this browser's personal records
            </h2>
            <span className="badge">Deliberate transfer</span>
          </div>
          <p>
            Original browser collection:{" "}
            {c.localPersonal?.tasks.length ?? "unreadable"} responsibilities and{" "}
            {c.localPersonal?.projects.length ?? "unreadable"} projects. The old
            browser keys are kept intact.
          </p>
          {c.localPersonalProtected ? (
            <p className="error">
              Original browser data is unreadable and protected. Open it and
              download the raw data before attempting recovery.
            </p>
          ) : (
            <>
              <div className="backup-actions">
                <button
                  className="button secondary"
                  onClick={() => {
                    downloadPrivate(
                      exportBackup(c.localPersonal!),
                      "steadier-original-browser-backup.json"
                    );
                    setMessage(
                      "Original browser backup download requested. Check your Downloads."
                    );
                  }}
                >
                  <Download size={16} />
                  Back up original browser data
                </button>
                <button
                  className="button primary"
                  disabled={
                    !emptyServer ||
                    c.pending ||
                    busy ||
                    (!c.localPersonal?.tasks.length &&
                      !c.localPersonal?.projects.length)
                  }
                  onClick={() => setConfirm("transfer")}
                >
                  <Upload size={16} />
                  Review initial transfer
                </button>
              </div>
              {!emptyServer && (
                <p className="small muted">
                  The server already holds information. Initial transfer is
                  disabled to avoid replacing it. Use checked backup/restore for
                  a deliberate replacement or additive task import for
                  additions.
                </p>
              )}
            </>
          )}
        </section>
      )}

      {c.active && c.conflict && (
        <section className="settings-section notice" role="alert">
          <h2>Both versions are held</h2>
          <p>
            Another device saved changes before this browser. Nothing is
            silently overwritten. Download your browser draft before choosing a
            version.
          </p>
          <p className="small">
            Browser: {store.workspace.tasks.length} responsibilities. Server
            revision {c.conflict.revision}: {c.conflict.workspace.tasks.length}{" "}
            responsibilities. Counts alone do not describe the differences.
          </p>
          <div className="backup-actions">
            <button
              className="button secondary"
              onClick={() =>
                downloadPrivate(
                  exportBackup(store.workspace),
                  "steadier-conflicting-browser-backup.json"
                )
              }
            >
              Download browser draft
            </button>
            <button
              className="button secondary"
              onClick={() =>
                downloadPrivate(
                  exportBackup(c.conflict!.workspace),
                  "steadier-conflicting-server-backup.json"
                )
              }
            >
              Download server version
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setConfirm("server")}
            >
              Review using server version
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setConfirm("local")}
            >
              Review replacing server with browser
            </button>
          </div>
        </section>
      )}

      {confirm && (
        <div
          className="notice"
          role="alertdialog"
          aria-labelledby="shared-confirm-title"
        >
          <strong id="shared-confirm-title">
            {confirm === "transfer"
              ? "Confirm private upload"
              : confirm === "server"
                ? "Confirm adopting the server version"
                : "Confirm replacing the server version"}
          </strong>
          <p>
            {confirm === "transfer"
              ? `Upload this browser's ${c.localPersonal?.tasks.length || 0} responsibilities and ${c.localPersonal?.projects.length || 0} projects into the empty private server space for this signed-in account? Their IDs, identity and history are retained. Original browser records are not removed.`
              : confirm === "server"
                ? "Replace the active browser draft with the current server collection? Download the draft first if it contains changes you want to keep."
                : "Replace the current server collection with this browser draft? This can replace changes from the other device. Download both versions first. A server recovery point and a revision check protect the operation."}
          </p>
          <div className="backup-actions">
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void run(
                  confirm === "transfer"
                    ? c.transferLocalPersonal
                    : confirm === "server"
                      ? c.useServerVersion
                      : c.keepLocalVersion,
                  "The checked operation completed; review the shared-space status."
                )
              }
            >
              {confirm === "transfer"
                ? "Upload into empty server space"
                : confirm === "server"
                  ? "Use server version"
                  : "Replace server with browser version"}
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <ClaudeSetup />
      <ChatGPTSetup voice={voice} />
      <ClaudeChangesPanel store={store} voice={voice} />
      <section className="settings-section">
        <div className="section-heading">
          <h2>
            <KeyRound size={21} /> Private read-only Compass access
          </h2>
          <span className="badge">Not connected automatically</span>
        </div>
        <p>
          A key lets your chosen AI read the saved server collection, including
          notes and outcomes across all areas. It cannot edit your tasks.
          Configure it only in a trusted private AI connection; never paste it
          into a public chat, link or sheet.
        </p>
        <p className="small muted">
          Context: <code>/api/compass/context</code>. Sheet:{" "}
          <code>/api/compass/sheet.csv</code>. Authentication:{" "}
          <code>Authorization: Bearer &lt;private key&gt;</code>. Use the
          published app address for a stable connection. A Preview address is
          not a dependable AI endpoint.
        </p>
        <label className="field">
          Key label
          <input
            value={keyLabel}
            maxLength={100}
            onChange={e => setKeyLabel(e.target.value)}
          />
        </label>
        <label className="checkbox-line">
          <input
            type="checkbox"
            checked={consent}
            onChange={e => setConsent(e.target.checked)}
          />
          I understand this grants read access to my saved personal context and
          will store the key privately.
        </label>
        <div className="backup-actions">
          <button
            className="button primary"
            disabled={!c.active || c.pending || !consent || busy || !c.user}
            onClick={async () => {
              const owner = c.user?.id;
              setBusy(true);
              setError("");
              try {
                const v = await ownedJSON<{
                  token: string;
                  info: CompassKeyInfo;
                }>("/api/steadier/compass-keys", {
                  method: "POST",
                  body: JSON.stringify({ label: keyLabel.trim() || "Compass" }),
                });
                setNewToken(v.token);
                setTokenOwner(owner || null);
                setReveal(false);
                await reloadKeys();
                setMessage(
                  "Read-only key created. Copy it now; the server stores only its hash."
                );
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Key could not be created."
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Create 90-day read-only key
          </button>
          <button
            className="button secondary"
            onClick={() =>
              downloadPrivate(
                JSON.stringify(openAPISchema(origin), null, 2),
                "steadier-compass-openapi.json"
              )
            }
          >
            Download API description
          </button>
          <button
            className="button secondary"
            onClick={() =>
              void copyPrivate(JSON.stringify(openAPISchema(origin), null, 2))
                .then(() =>
                  setMessage(
                    "API description copied. It contains no private key."
                  )
                )
                .catch(e => setError(e.message))
            }
          >
            Copy API description
          </button>
        </div>
        {newToken && tokenOwner === c.user?.id && (
          <div className="notice">
            <strong>Shown once — keep this key private</strong>
            <label className="field">
              New private key
              <input
                className="private-token"
                type={reveal ? "text" : "password"}
                readOnly
                value={newToken}
                autoComplete="off"
              />
            </label>
            <div className="backup-actions">
              <button
                className="button secondary"
                onClick={() =>
                  void copyPrivate(newToken)
                    .then(() =>
                      setMessage(
                        "Private key copied. Store it only in your AI's authentication settings."
                      )
                    )
                    .catch(e => setError(e.message))
                }
              >
                <ClipboardCopy size={16} />
                Copy private key
              </button>
              <button
                className="text-button"
                onClick={() => setReveal(!reveal)}
              >
                {reveal ? "Hide" : "Reveal"}
              </button>
              <button className="text-button" onClick={() => setNewToken("")}>
                Clear from this screen
              </button>
            </div>
          </div>
        )}
        {!!keys.length && (
          <div className="key-list">
            {keys.map(k => (
              <div className="key-row" key={k.id}>
                <div>
                  <strong>{k.label}</strong>
                  <span className="small muted">
                    {k.revokedAt
                      ? "Revoked"
                      : new Date(k.expiresAt).getTime() < Date.now()
                        ? "Expired"
                        : k.scope?.includes("steadier:write")
                          ? "Read & changes"
                          : "Read-only"}{" "}
                    · expires {formatAdelaide(k.expiresAt, { time: false })} ·
                    last used{" "}
                    {k.lastUsedAt ? formatAdelaide(k.lastUsedAt) : "not yet"}
                  </span>
                </div>
                {!k.revokedAt && (
                  <button
                    className="button secondary small-button"
                    disabled={busy}
                    onClick={() => setRevokeId(k.id)}
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {revokeId !== null && (
          <div
            className="notice"
            role="alertdialog"
            aria-label="Revoke Compass access"
          >
            <p>
              Revoke this key now? Any AI using it will lose read access. You
              can issue another key later.
            </p>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await ownedJSON(`/api/steadier/compass-keys/${revokeId}`, {
                    method: "DELETE",
                  });
                  setNewToken("");
                  await reloadKeys();
                  setRevokeId(null);
                  setMessage("Key revoked. It can no longer read the server.");
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Revoke failed.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Revoke this key
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setRevokeId(null)}
            >
              Cancel
            </button>
          </div>
        )}
        <p className="small muted">
          This supplies a connection capability, not an already-configured
          Compass client. Live data does not continuously wake an AI, listen to
          you, or prove drift. Proactive check-ins require a separate explicit
          setup.
        </p>
      </section>
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
      <div className="privacy-note">
        <ShieldCheck size={17} />
        <p>
          Keep downloaded full backups. Offline edits may be recoverable on this
          browser but are not live on the server until sync is confirmed. Shared
          records are private to your signed-in account.
        </p>
      </div>
    </div>
  );
}
