import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  Check,
  Download,
  History,
  RotateCcw,
  Square,
  Trash2,
  Volume2,
} from "lucide-react";
import type { useSharedWorkspace } from "../../hooks/useSharedWorkspace";
import type {
  PendingDeleteRequest,
  WorkspaceBackupSummary,
} from "../../../../shared/cloud";
import { adelaideDate } from "../../../../shared/time";
import {
  downloadPrivate,
  privateOwnerJSON,
  privateOwnerRequest,
} from "../../lib/cloudApi";

type Store = ReturnType<typeof useSharedWorkspace>;
type Voice = {
  speechSupported: boolean;
  speaking: boolean;
  read: (text: string) => void;
  stopSpeaking: () => void;
};

type Confirming =
  | { kind: "delete"; request: PendingDeleteRequest }
  | { kind: "restore"; backup: WorkspaceBackupSummary }
  | null;

function who(actor: WorkspaceBackupSummary["actor"]): string {
  return actor === "owner"
    ? "You"
    : actor === "chatgpt"
      ? "ChatGPT"
      : actor === "claude"
        ? "Claude"
        : "MCP connector";
}

function requestedBy(request: PendingDeleteRequest): string {
  return request.requestedBy === "chatgpt"
    ? "ChatGPT"
    : request.requestedBy === "connector"
      ? "MCP connector"
      : "Claude";
}

/** Connector delete requests, automatic server backups, owner-only restore and manual export. */
export default function ClaudeChangesPanel({
  store,
  voice,
  compact = false,
}: {
  store: Store;
  voice?: Voice;
  compact?: boolean;
}) {
  const c = store.cloud;
  const owner = c.user?.id ?? 0;
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const [pending, setPending] = useState<PendingDeleteRequest[]>([]);
  const [backups, setBackups] = useState<WorkspaceBackupSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!c.active || !owner) return;
    const requestedFor = owner;
    try {
      const [p, b] = await Promise.all([
        privateOwnerJSON<{ pending: PendingDeleteRequest[] }>(
          requestedFor,
          "/api/steadier/pending-deletes"
        ),
        compact
          ? Promise.resolve({ backups: [] as WorkspaceBackupSummary[] })
          : privateOwnerJSON<{ backups: WorkspaceBackupSummary[] }>(
              requestedFor,
              "/api/steadier/backups"
            ),
      ]);
      if (ownerRef.current !== requestedFor) return;
      setPending(p.pending);
      if (!compact) setBackups(b.backups);
      setLoaded(true);
    } catch (e) {
      if (!compact)
        setError(e instanceof Error ? e.message : "Backups could not load.");
    }
  }, [c.active, owner, compact]);

  // A new server revision refreshes the lists after any connector or owner action.
  useEffect(() => {
    void reload();
  }, [reload, c.revision]);

  const blocked = c.pending
    ? "This device has changes not yet saved to the server. Wait until it shows Synced, then decide."
    : c.status === "offline"
      ? "You are offline. Reconnect before deciding."
      : c.conflict
        ? "Resolve the two held versions under Server & Compass first."
        : "";

  async function act(
    path: string,
    success: string,
    method: "POST" = "POST"
  ): Promise<void> {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await privateOwnerJSON(owner, path, { method, body: "{}" });
      // Pull the server's new revision so this screen shows the real result.
      await c.retry();
      await reload();
      setMessage(success);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The server could not complete this."
      );
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  async function downloadFull(): Promise<void> {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await privateOwnerRequest(owner, "/api/steadier/export");
      if (!response.ok)
        throw new Error(
          "The full backup could not be prepared. Retry when connected."
        );
      downloadPrivate(
        await response.text(),
        `steadier-full-backup-${adelaideDate()}.json`
      );
      setMessage(
        "Full backup download requested. Check your Downloads and keep a copy outside this phone. It restores through Backups & trial → Restore."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download could not start.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadBackup(backup: WorkspaceBackupSummary): Promise<void> {
    setError("");
    try {
      const response = await privateOwnerRequest(
        owner,
        `/api/steadier/backups/${backup.id}/download`
      );
      if (!response.ok) throw new Error("That backup could not be downloaded.");
      downloadPrivate(
        await response.text(),
        `steadier-server-backup-${backup.id}.json`
      );
      setMessage(`Backup from ${backup.createdAtLocal} download requested.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download could not start.");
    }
  }

  function readAloud(): void {
    if (!voice) return;
    if (voice.speaking) {
      voice.stopSpeaking();
      return;
    }
    const requests = pending.length
      ? `${pending
          .map(requestedBy)
          .filter((name, i, all) => all.indexOf(name) === i)
          .join(
            " and "
          )} is asking to delete ${pending.length} item${pending.length === 1 ? "" : "s"}. ${pending
          .map(
            r =>
              `${requestedBy(r)} asked to remove ${r.itemKind} ${r.itemTitle}, because ${r.reason}.`
          )
          .join(" ")} Nothing is removed until you choose Delete.`
      : "There are no delete requests waiting.";
    const recent = compact
      ? ""
      : ` ${backups.length} server backups are kept. Most recent changes: ${backups
          .slice(0, 5)
          .map(b => `${b.createdAtLocal}, ${b.reason}.`)
          .join(" ")}`;
    voice.read(`${requests}${recent}`);
  }

  if (!c.active || !owner) {
    if (compact) return null;
    return (
      <section className="settings-section">
        <div className="section-heading">
          <h2>
            <History size={21} /> Connector changes & server backups
          </h2>
        </div>
        <p>
          Connect your shared personal space above to see connector changes,
          delete requests and the server's automatic backups.
        </p>
      </section>
    );
  }
  if (compact && pending.length === 0) return null;

  const pendingList = (
    <div className="claude-requests">
      {pending.map(request => (
        <article
          key={request.id}
          className="claude-request"
          aria-label={`Delete request for ${request.itemTitle}`}
        >
          <p>
            <span className="badge claude-chip">{requestedBy(request)}</span>{" "}
            asks to delete the {request.itemKind}{" "}
            <strong>{request.itemTitle}</strong>
          </p>
          <p className="small muted">
            Requested {request.requestedAtLocal}. Reason given: {request.reason}
            {request.itemKind === "project"
              ? " Its tasks are kept and only unlinked."
              : ""}
          </p>
          <div className="backup-actions">
            <button
              className="button secondary danger-outline"
              disabled={busy || !!blocked}
              onClick={() => setConfirming({ kind: "delete", request })}
            >
              <Trash2 size={16} /> Delete
            </button>
            <button
              className="button secondary"
              disabled={busy || !!blocked}
              onClick={() =>
                void act(
                  `/api/steadier/pending-deletes/${request.id}/keep`,
                  `Kept “${request.itemTitle}”. ${requestedBy(request)}'s request is closed.`
                )
              }
            >
              <Check size={16} /> Keep it
            </button>
          </div>
        </article>
      ))}
    </div>
  );

  const confirmBox = confirming && (
    <div
      className="notice"
      role="alertdialog"
      aria-labelledby="claude-change-confirm"
    >
      <strong id="claude-change-confirm">
        {confirming.kind === "delete"
          ? `Delete “${confirming.request.itemTitle}”?`
          : `Restore the backup from ${confirming.backup.createdAtLocal}?`}
      </strong>
      <p>
        {confirming.kind === "delete"
          ? "This removes it from My Life on every device. A full backup is saved on the server first, so you can restore it later."
          : `Your whole My Life will be replaced by this snapshot (${confirming.backup.taskCount} tasks, ${confirming.backup.projectCount} projects). Your current version is backed up first, so this can be undone by restoring that newer backup. Any running focus timer is paused.`}
      </p>
      <div className="backup-actions">
        <button
          className="button primary"
          disabled={busy}
          onClick={() =>
            confirming.kind === "delete"
              ? void act(
                  `/api/steadier/pending-deletes/${confirming.request.id}/confirm`,
                  `Deleted “${confirming.request.itemTitle}”. A backup from just before is in the list.`
                )
              : void act(
                  `/api/steadier/backups/${confirming.backup.id}/restore`,
                  `Restored the backup from ${confirming.backup.createdAtLocal}. Your previous version is now the newest backup.`
                )
          }
        >
          {busy
            ? "Working…"
            : confirming.kind === "delete"
              ? "Yes, delete"
              : "Yes, restore"}
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => setConfirming(null)}
        >
          Cancel
        </button>
      </div>
    </div>
  );

  const feedback = (
    <>
      {blocked && (pending.length > 0 || !compact) && (
        <p className="small muted">{blocked}</p>
      )}
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
    </>
  );

  const speakButton = voice?.speechSupported ? (
    <button className="button secondary" onClick={readAloud}>
      {voice.speaking ? <Square size={15} /> : <Volume2 size={16} />}
      {voice.speaking ? "Stop reading" : "Read aloud"}
    </button>
  ) : null;

  if (compact) {
    return (
      <section
        className="settings-section notice claude-requests-today"
        aria-labelledby="claude-requests-title"
      >
        <div className="section-heading">
          <h2 id="claude-requests-title">
            <Trash2 size={19} /> Waiting for you: connector delete request
            {pending.length === 1 ? "" : "s"}
          </h2>
          {speakButton}
        </div>
        <p className="small">
          Nothing is removed until you choose Delete. Keep closes the request.
        </p>
        {pendingList}
        {confirmBox}
        {feedback}
      </section>
    );
  }

  return (
    <section
      className="settings-section"
      aria-labelledby="claude-changes-title"
    >
      <div className="section-heading">
        <h2 id="claude-changes-title">
          <History size={21} /> Connector changes & server backups
        </h2>
        <span className="badge">Last {20} kept</span>
      </div>
      <p>
        Before every change made through a connector, and before you delete or
        restore here, the server saves a full dated snapshot of your whole My
        Life. If that snapshot fails, the change does not happen. Only you can
        restore.
      </p>
      <div className="backup-actions">
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void downloadFull()}
        >
          <Download size={16} /> Download full backup now
        </button>
        {speakButton}
      </div>

      <h3>Delete requests from connectors</h3>
      {pending.length ? (
        pendingList
      ) : (
        <p className="small muted">{loaded ? "None waiting." : "Loading…"}</p>
      )}

      <h3>Server backups (Adelaide time)</h3>
      {backups.length === 0 ? (
        <p className="small muted">
          {loaded
            ? "No backups yet. The first appears just before the first change from a connector, a delete or a restore."
            : "Loading…"}
        </p>
      ) : (
        <ol className="backup-list">
          {backups.map(backup => (
            <li key={backup.id} className="backup-row">
              <div>
                <strong>{backup.createdAtLocal}</strong>{" "}
                <span
                  className={`badge ${backup.actor === "owner" ? "" : "claude-chip"}`}
                >
                  {who(backup.actor)}
                </span>
                <p className="small">
                  Snapshot taken before:{" "}
                  {backup.reason.replace(
                    /^(Claude|ChatGPT|MCP connector): /,
                    ""
                  )}
                </p>
                <p className="small muted">
                  {backup.taskCount} tasks · {backup.projectCount} projects ·
                  server revision {backup.sourceRevision}
                </p>
              </div>
              <div className="backup-actions">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void downloadBackup(backup)}
                >
                  <Archive size={15} /> Download
                </button>
                <button
                  className="button secondary"
                  disabled={busy || !!blocked}
                  onClick={() => setConfirming({ kind: "restore", backup })}
                >
                  <RotateCcw size={15} /> Restore
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {confirmBox}
      {feedback}
    </section>
  );
}
