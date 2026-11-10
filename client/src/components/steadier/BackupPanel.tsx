import { useEffect, useId, useRef, useState } from "react";
import { formatAdelaide } from "../../../../shared/time";
import {
  ClipboardCopy,
  Download,
  HardDrive,
  History,
  RotateCcw,
  ShieldCheck,
  Upload,
  Volume2,
  Square,
} from "lucide-react";
import type { useWorkspace } from "../../hooks/useWorkspace";
import { exportBackup, parseBackup } from "../../domain/transfer";
import {
  downloadBackup as download,
  copyBackupText as copyText,
} from "../../domain/backupTransport";
import type { Workspace } from "../../domain/types";

type Store = ReturnType<typeof useWorkspace>;

interface RestoreCandidate {
  workspace: Workspace;
  source: string;
  scope: string;
}

interface Props {
  store: Store;
  onRestored?: () => void;
  shared?: boolean;
  onRestore?: (workspace: Workspace) => Promise<boolean>;
  onRead?: (text: string) => void;
  onStopReading?: () => void;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function localStamp(value: string | null): string {
  if (!value) return "Not requested yet";
  return formatAdelaide(value) || value;
}

function fileStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function preparationError(error: unknown): string {
  const detail =
    error instanceof Error &&
    error.message.startsWith("Could not import tasks:")
      ? ` ${error.message.slice(0, 300)}`
      : "";
  return `The saved collection could not be prepared as a full backup.${detail} Your records were not changed. Keep this page open; do not clear its data.`;
}

/** Complete, checked v2 backup and recovery controls for one local workspace. */
export default function BackupPanel({
  store,
  onRestored,
  shared = false,
  onRestore,
  onRead,
  onStopReading,
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const restoreAttempt = useRef(0);
  const [candidate, setCandidate] = useState<RestoreCandidate | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [persistenceMessage, setPersistenceMessage] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [shownBackup, setShownBackup] = useState<string | null>(null);
  const shownInput = useRef<HTMLTextAreaElement>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pastedBackup, setPastedBackup] = useState("");
  const scope = `${shared ? "shared" : "browser"}:${store.kind}:${store.generation}`;
  const [stateScope, setStateScope] = useState(scope);
  const sameScope = stateScope === scope;
  const [shownRaw, setShownRaw] = useState<string | null>(null);
  const rawInput = useRef<HTMLTextAreaElement>(null);
  const backupId = useId();
  const pasteId = useId();
  const rawId = useId();
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const stopRef = useRef(onStopReading);
  stopRef.current = onStopReading;

  useEffect(() => {
    restoreAttempt.current += 1;
    setCandidate(null);
    setShownBackup(null);
    setPasteOpen(false);
    setPastedBackup("");
    setShownRaw(null);
    setStateScope(scope);
    setPersistenceMessage("");
    setError("");
    setMessage("");
    stopRef.current?.();
    return () => stopRef.current?.();
  }, [scope]);

  const backupText = () => {
    if (store.readOnly)
      throw new Error(
        "The saved workspace is unreadable. Download raw saved data or restore a checked backup instead."
      );
    return exportBackup(store.workspace);
  };
  const beginRestore = (workspace: Workspace, source: string) => {
    restoreAttempt.current += 1;
    setError("");
    setMessage("");
    setCandidate({ workspace, source, scope: scopeRef.current });
  };
  const requestDownload = () => {
    let text: string;
    try {
      text = backupText();
    } catch (e) {
      setError(preparationError(e));
      return;
    }
    setMessage("");
    try {
      download(text, `steadier-${store.kind}-backup-${fileStamp()}.json`);
    } catch {
      setShownBackup(text);
      setError(
        "This browser could not start the download. Your backup is shown below. Use Copy backup text or select it and use your phone's Copy command."
      );
      return;
    }
    setError("");
    let recorded = false;
    try {
      recorded = store.markExported();
    } catch {
      /* A bookkeeping error does not invalidate the prepared backup. */
    }
    setMessage(
      `Download requested, not confirmed saved. If your phone reports failure, use Copy backup text or Show backup text. Keep a copy outside this browser.${recorded ? "" : " The download reminder could not be updated."}`
    );
  };
  const requestCopy = async () => {
    const captured = scopeRef.current;
    let text: string;
    try {
      text = backupText();
    } catch (e) {
      setError(preparationError(e));
      return;
    }
    try {
      await copyText(text);
      if (captured !== scopeRef.current) return;
      setError("");
      setMessage(
        "Full backup text copied. In the shared app choose Restore from backup text. Do not paste it into a public chat; keep the original Preview open until transfer is confirmed."
      );
    } catch {
      if (captured !== scopeRef.current) return;
      setShownBackup(text);
      setMessage("");
      setError(
        "Automatic copy is blocked here. Your private backup is shown below. Tap Select all backup text, then use your phone's Copy command."
      );
    }
  };
  const showBackup = () => {
    try {
      setShownBackup(backupText());
      setError("");
      setMessage(
        "Private backup prepared as text only. Nothing was uploaded or replaced."
      );
    } catch (e) {
      setError(preparationError(e));
    }
  };
  const checkPastedBackup = () => {
    restoreAttempt.current += 1;
    setCandidate(null);
    try {
      const checked = parseBackup(pastedBackup);
      beginRestore(checked, "Pasted full backup text");
      setPastedBackup("");
      setPasteOpen(false);
      setShownBackup(null);
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message} Nothing was replaced.`
          : "This is not a checked full backup. Nothing was replaced."
      );
    }
  };
  const confirmRestore = async () => {
    if (!candidate || restoring) return;
    if (candidate.scope !== scopeRef.current) {
      setCandidate(null);
      setError(
        "The selected space changed. Check the backup again before replacing anything."
      );
      return;
    }
    setRestoring(true);
    let success = false;
    try {
      success = onRestore
        ? await onRestore(candidate.workspace)
        : store.restoreBackup(candidate.workspace);
    } catch {
      success = false;
    }
    setRestoring(false);
    if (success) {
      setMessage(
        `${candidate.source} restored. It replaced this ${store.kind} workspace, including its task and project identities.`
      );
      setError("");
      setCandidate(null);
      setShownBackup(null);
      setPastedBackup("");
      setPasteOpen(false);
      onStopReading?.();
      onRestored?.();
    } else {
      setError(
        "Restore could not be confirmed in this workspace. Check the sync/storage warning and retained copies before trying again."
      );
    }
  };

  return (
    <section className="settings-section" aria-labelledby="backup-heading">
      <div className="section-heading">
        <h2 id="backup-heading">
          <ShieldCheck size={21} />
          Full backup & recovery
        </h2>
        <span className="badge">
          {shared ? "Shared + portable" : "Local-first"}
        </span>
      </div>
      <p>
        A full backup keeps responsibilities, projects, milestones, progress,
        matrix emphasis, Compass intention, focus and trial notes together. It
        is the only restore format that preserves IDs and links exactly.
      </p>
      <p className="small">
        Selected collection:{" "}
        <strong>
          {shared ? "shared server" : "this browser"} · {store.kind}
        </strong>
        .
        {!store.readOnly && (
          <>
            {" "}
            {store.workspace.tasks.length} responsibilities and{" "}
            {store.workspace.projects.length} projects.
          </>
        )}
        {store.kind === "demo" && (
          <> This is the sample workspace, not your personal space.</>
        )}
      </p>
      <p className="small muted">
        Last download requested:{" "}
        {localStamp(store.workspace.trial.lastExportAt)}. The browser cannot
        confirm that a downloaded file was saved.
      </p>
      <div className="backup-actions">
        <button
          className="button primary"
          onClick={requestDownload}
          disabled={store.readOnly || restoring}
        >
          <Download size={16} />
          Download full backup
        </button>
        <button
          className="button secondary"
          onClick={() => void requestCopy()}
          disabled={store.readOnly || restoring}
        >
          <ClipboardCopy size={16} />
          Copy backup text
        </button>
        <button
          className="button secondary"
          onClick={showBackup}
          disabled={store.readOnly || restoring}
        >
          Show backup text
        </button>
        <button
          className="button secondary"
          disabled={restoring}
          onClick={() => input.current?.click()}
        >
          <Upload size={16} />
          Restore full backup
        </button>
        <button
          className="button secondary"
          disabled={restoring}
          onClick={() => {
            restoreAttempt.current += 1;
            setCandidate(null);
            setShownBackup(null);
            setPastedBackup("");
            setPasteOpen(true);
            setError("");
            setMessage("");
          }}
        >
          Restore from backup text
        </button>
      </div>
      <div className="notice">
        <strong>Phone cannot download? Use text instead.</strong>
        <p>
          Copy the full backup from the original Preview. In the published app,
          open your shared personal space, then use Restore from backup text.
          Check the counts before confirming. Keep the original open until the
          server says Synced.
        </p>
        {onRead && (
          <div className="backup-actions">
            <button
              className="button secondary"
              onClick={() =>
                onRead(
                  "If your phone cannot download, keep the original Preview open and choose Copy backup text. In the published app, open your shared personal space. Choose Restore from backup text, paste it, and check the responsibility and project counts. Nothing is replaced until you confirm. Wait for Synced before asking Compass to read again. Never paste private backup text into a public chat."
                )
              }
            >
              <Volume2 size={16} /> Read backup help aloud
            </button>
            {onStopReading && (
              <button className="button secondary" onClick={onStopReading}>
                <Square size={15} /> Stop reading
              </button>
            )}
          </div>
        )}
      </div>
      <input
        ref={input}
        hidden
        type="file"
        accept=".json,application/json"
        onChange={async event => {
          const attempt = ++restoreAttempt.current;
          setCandidate(null);
          setPasteOpen(false);
          setPastedBackup("");
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setError("");
          setMessage("");
          if (file.size > MAX_FILE_BYTES) {
            setError("Choose a backup smaller than 5 MB.");
            return;
          }
          try {
            const text = await file.text();
            if (attempt !== restoreAttempt.current) return;
            beginRestore(parseBackup(text), `Backup “${file.name}”`);
          } catch (parseError) {
            if (attempt !== restoreAttempt.current) return;
            setCandidate(null);
            setError(
              parseError instanceof Error
                ? `${parseError.message} Nothing was replaced.`
                : "This file is not a checked Steadier backup. Nothing was replaced."
            );
          }
        }}
      />

      {sameScope && shownBackup !== null && (
        <div
          className="notice rr-block"
          data-private="true"
          data-hj-suppress="true"
        >
          <strong>Private backup text</strong>
          <p>
            This is the prepared backup, not a saved file. Select all and use
            your phone's Copy command if automatic copy is blocked. Keep this
            text private.
          </p>
          <div className="field">
            <label htmlFor={backupId}>Full backup JSON</label>
            <textarea
              id={backupId}
              ref={shownInput}
              readOnly
              value={shownBackup}
              rows={7}
              spellCheck={false}
              autoComplete="off"
              className="rr-mask"
              data-ms-mask="true"
            />
          </div>
          <div className="backup-actions">
            <button
              className="button secondary"
              onClick={() => {
                shownInput.current?.focus();
                shownInput.current?.select();
                shownInput.current?.setSelectionRange(0, shownBackup.length);
                setMessage(
                  "Backup text selected. Use your phone's Copy command; nothing was uploaded."
                );
              }}
            >
              Select all backup text
            </button>
            <button
              className="button secondary"
              onClick={() => {
                setShownBackup(null);
                setMessage("");
              }}
            >
              Hide backup text
            </button>
          </div>
        </div>
      )}

      {sameScope && pasteOpen && (
        <div
          className="notice rr-block"
          data-private="true"
          data-hj-suppress="true"
        >
          <strong>Paste your full backup here</strong>
          <p>
            Target:{" "}
            <strong>
              {shared ? "shared server" : "this browser"} · {store.kind}
            </strong>
            . Nothing changes when you paste or check. Replacement needs a
            separate confirmation after the counts are shown.
          </p>
          <div className="field">
            <label htmlFor={pasteId}>Full backup text to check</label>
            <textarea
              id={pasteId}
              value={pastedBackup}
              onChange={event => {
                restoreAttempt.current += 1;
                setCandidate(null);
                const text = event.target.value;
                if (text.length > MAX_FILE_BYTES) {
                  setError(
                    "Choose backup text smaller than 5 MB. Nothing was replaced."
                  );
                  return;
                }
                setPastedBackup(text);
                setError("");
              }}
              rows={7}
              spellCheck={false}
              autoComplete="off"
              className="rr-mask"
              data-ms-mask="true"
              placeholder="Paste the complete JSON backup, not a CSV or screenshot."
            />
          </div>
          <div className="backup-actions">
            <button
              className="button primary"
              disabled={restoring || !pastedBackup.trim()}
              onClick={checkPastedBackup}
            >
              Check pasted backup
            </button>
            <button
              className="button secondary"
              disabled={restoring}
              onClick={() => {
                restoreAttempt.current += 1;
                setPastedBackup("");
                setPasteOpen(false);
                setCandidate(null);
                setError("");
              }}
            >
              Cancel paste
            </button>
          </div>
        </div>
      )}

      {sameScope && candidate && candidate.scope === scope && (
        <div
          className="notice"
          role="alertdialog"
          aria-labelledby="restore-confirm-title"
        >
          <strong id="restore-confirm-title">
            Check before replacing this workspace
          </strong>
          <p>
            {candidate.source} contains {candidate.workspace.tasks.length} task
            {candidate.workspace.tasks.length === 1 ? "" : "s"} and{" "}
            {candidate.workspace.projects.length} project
            {candidate.workspace.projects.length === 1 ? "" : "s"}. Restoring
            replaces the current <strong>{store.kind}</strong> workspace; it is
            not an additive import.
          </p>
          <p className="small">
            {shared
              ? "A server recovery point and revision check protect a confirmed replacement; keep a downloaded backup as well."
              : "A local pre-restore recovery copy is made first when storage allows."}
            In a protected unreadable workspace, the original raw bytes are kept
            separately before replacement.
          </p>
          <div className="backup-actions">
            <button
              className="button primary"
              disabled={restoring}
              onClick={() => void confirmRestore()}
            >
              <RotateCcw size={16} />
              Replace {store.kind} workspace
            </button>
            <button
              className="button secondary"
              disabled={restoring}
              onClick={() => {
                restoreAttempt.current += 1;
                setCandidate(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="scenario-principles">
        <strong>
          <History size={15} />{" "}
          {shared
            ? "Recovery copies for this shared space"
            : "Local recovery copies"}
        </strong>
        <p>
          Up to three dated copies are kept before meaningful task or project
          changes, one per day. They are a convenience, not an off-device
          backup: browser storage can be cleared or evicted with the workspace.
        </p>
        {store.recoveryCopies.length ? (
          <div className="backup-actions">
            {store.recoveryCopies.map(copy => (
              <button
                key={copy.id}
                className="button secondary"
                onClick={() =>
                  beginRestore(
                    copy.workspace,
                    `Local recovery copy from ${localStamp(copy.at)}`
                  )
                }
              >
                <History size={15} />
                Preview {localStamp(copy.at)}
              </button>
            ))}
          </div>
        ) : (
          <p className="small muted">No recovery copy is available yet.</p>
        )}
      </div>

      {store.corruptRaw !== null && (
        <div className="notice" role="alert">
          <strong>Unreadable saved data is protected</strong>
          <p>
            This workspace is read-only until a checked backup is restored. You
            can download the original raw browser bytes for private recovery; it
            may not be valid JSON.
          </p>
          <button
            className="button secondary"
            onClick={() => {
              try {
                download(
                  store.corruptRaw as string,
                  `steadier-${store.kind}-unreadable-storage-${fileStamp()}.txt`,
                  "text/plain;charset=utf-8"
                );
                setMessage(
                  "Raw-data download requested, not confirmed saved. If your phone refuses, use Show raw saved data."
                );
              } catch {
                setShownRaw(store.corruptRaw);
                setError(
                  "Raw-data download could not start. The original bytes are shown below, not converted into a valid backup."
                );
              }
            }}
          >
            <Download size={16} />
            Download raw saved data
          </button>
          <button
            className="button secondary"
            onClick={() => {
              setShownRaw(store.corruptRaw);
              setError("");
            }}
          >
            Show raw saved data
          </button>
          {sameScope && shownRaw !== null && (
            <div
              className="rr-block"
              data-private="true"
              data-hj-suppress="true"
            >
              <p>
                <strong>Original raw text — not a checked full backup.</strong>{" "}
                It may be invalid JSON. Keep it private and preserve it for
                recovery; do not assume it can be restored.
              </p>
              <div className="field">
                <label htmlFor={rawId}>Original raw saved data</label>
                <textarea
                  id={rawId}
                  ref={rawInput}
                  readOnly
                  value={shownRaw}
                  rows={7}
                  spellCheck={false}
                  autoComplete="off"
                  className="rr-mask"
                  data-ms-mask="true"
                />
              </div>
              <div className="backup-actions">
                <button
                  className="button secondary"
                  onClick={() => {
                    rawInput.current?.focus();
                    rawInput.current?.select();
                    rawInput.current?.setSelectionRange(0, shownRaw.length);
                  }}
                >
                  Select all raw text
                </button>
                <button
                  className="button secondary"
                  onClick={() => setShownRaw(null)}
                >
                  Hide raw text
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="backup-actions">
        <button
          className="text-button"
          disabled={store.readOnly || restoring}
          onClick={() => {
            if (store.markReviewed()) {
              setMessage(
                "Week-end review noted. Check the shared-space status when connected."
              );
              setError("");
            }
          }}
        >
          <History size={15} />
          Mark this review done
        </button>
        <button
          className="text-button"
          onClick={async () => {
            try {
              const granted = await navigator.storage?.persist?.();
              setPersistenceMessage(
                granted
                  ? "Browser persistent storage was granted. Keep downloading backups; this is still not cloud storage."
                  : "The browser did not grant persistent storage. Keep downloading backups."
              );
            } catch {
              setPersistenceMessage(
                "Persistent storage is not available in this browser."
              );
            }
          }}
        >
          <HardDrive size={15} />
          Ask browser to reduce eviction
        </button>
      </div>
      <p className="small muted">
        Last review noted: {localStamp(store.workspace.trial.lastReviewAt)}.
      </p>
      {sameScope && persistenceMessage && (
        <p className="small" role="status">
          {persistenceMessage}
        </p>
      )}

      <div className="privacy-note">
        <strong>A practical one-week trial</strong>
        <p>
          Start with a small real collection. Each day, open Steadier, choose a
          Compass intention and one re-entry step, then download a full backup
          after meaningful changes. At week end, mark a review, look at what
          helped, and only then extend the same gentle routine toward a month.
        </p>
        <p className="small">
          {shared
            ? "Shared personal records are saved to your private server account when sync is confirmed. Offline drafts are not yet visible to Compass. Keep downloaded backups; there are no reliable closed-app reminders or scheduled off-device backups."
            : "This browser collection is not shared. Connect under Server & Compass for phone/laptop access. Keep downloaded backups and existing critical reminders."}
        </p>
      </div>

      {sameScope && message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {sameScope && error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
