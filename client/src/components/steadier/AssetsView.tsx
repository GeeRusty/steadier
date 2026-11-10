import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowRight,
  Mic,
  Package,
  Plus,
  Square,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import {
  addAssetRecord,
  addAssetWearLog,
  ASSET_CONDITIONS,
  MAX_ASSETS,
  MAX_ASSET_CATEGORY_LENGTH,
  MAX_ASSET_LOGS_PER_ASSET,
  MAX_ASSET_LOGS_TOTAL,
  MAX_ASSET_LOG_TEXT_LENGTH,
  MAX_ASSET_NAME_LENGTH,
  removeAssetRecord,
  removeAssetWearLog,
  setAssetStatus,
  updateAssetRecord,
  updateAssetWearLog,
} from "../../domain/assets";
import { adelaideClock, isDate } from "../../domain/time";
import type {
  Asset,
  AssetCondition,
  AssetWearLog,
  Project,
  Task,
  Workspace,
} from "../../domain/types";
import { groupByStable } from "../../domain/accordionGroups";
import AccordionSection from "./AccordionSection";
import { adelaideTimestamp } from "../../../../shared/time";
import type { useVoice } from "../../hooks/useVoice";

const CONDITION_LABELS: Record<AssetCondition, string> = {
  unknown: "Not assessed",
  good: "Good",
  fair: "Fair",
  worn: "Worn",
  "needs-attention": "Needs attention",
};

interface Props {
  workspace: Workspace;
  readOnly: boolean;
  voice: ReturnType<typeof useVoice>;
  onMutate: (change: (workspace: Workspace) => Workspace) => boolean;
  onTaskDraft: (assetId: string, logId: string, text: string) => void;
  onOpenTask: (task: Task) => void;
}

type AssetEditor = { mode: "new" } | { mode: "edit"; assetId: string };
type DeleteTarget =
  | { kind: "asset"; assetId: string }
  | { kind: "log"; assetId: string; logId: string };

function makeId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function formatDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const value = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  );
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

export default function AssetsView({
  workspace,
  readOnly,
  voice,
  onMutate,
  onTaskDraft,
  onOpenTask,
}: Props) {
  const assets = workspace.assets ?? [];
  const projects = workspace.projects;
  const [search, setSearch] = useState("");
  const [showRetired, setShowRetired] = useState(false);
  const [editor, setEditor] = useState<AssetEditor | null>(null);
  const [assetName, setAssetName] = useState("");
  const [category, setCategory] = useState("");
  const [projectId, setProjectId] = useState("");
  const [initialCondition, setInitialCondition] =
    useState<AssetCondition>("unknown");
  const [logTargetAssetId, setLogTargetAssetId] = useState<string | null>(null);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [logDate, setLogDate] = useState(adelaideClock().date);
  const [logCondition, setLogCondition] = useState<AssetCondition>("unknown");
  const [logText, setLogText] = useState("");
  const [draftSource, setDraftSource] = useState<"typed" | "voice">("typed");
  const [statusMessage, setStatusMessage] = useState("");
  const [pendingDelete, setPendingDelete] = useState<DeleteTarget | null>(null);
  const dictationActive = useRef(false);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  useEffect(() => {
    if (dictationActive.current && voice.transcript.trim()) {
      setLogText(voice.transcript);
    }
  }, [voice.transcript]);

  useEffect(
    () => () => {
      dictationActive.current = false;
      voiceRef.current.abort();
      voiceRef.current.clear();
    },
    []
  );

  const totalLogs = useMemo(
    () => assets.reduce((total, asset) => total + asset.wearLogs.length, 0),
    [assets]
  );
  const filteredAssets = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return assets
      .filter(asset => showRetired || asset.status === "active")
      .filter(asset => {
        if (!query) return true;
        return `${asset.name} ${asset.category} ${asset.wearLogs
          .map(log => log.text)
          .join(" ")}`
          .toLocaleLowerCase()
          .includes(query);
      })
      .sort((a, b) =>
        a.status === b.status
          ? b.updatedAt.localeCompare(a.updatedAt)
          : a.status === "active"
            ? -1
            : 1
      );
  }, [assets, search, showRetired]);
  const assetGroups = useMemo(
    () =>
      groupByStable(filteredAssets, asset => ({
        key:
          asset.category.trim().toLocaleLowerCase("en-AU") || "uncategorised",
        label: asset.category.trim() || "Uncategorised",
      })),
    [filteredAssets]
  );

  function resetAssetEditor() {
    setEditor(null);
    setAssetName("");
    setCategory("");
    setProjectId("");
    setInitialCondition("unknown");
  }

  function beginNewAsset() {
    resetAssetEditor();
    setEditor({ mode: "new" });
    setStatusMessage("");
  }

  function beginEditAsset(asset: Asset) {
    resetAssetEditor();
    setEditor({ mode: "edit", assetId: asset.id });
    setAssetName(asset.name);
    setCategory(asset.category);
    setProjectId(asset.projectId ?? "");
    setInitialCondition(asset.condition);
    setStatusMessage("");
  }

  function saveAsset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    const name = assetName.trim();
    const cleanCategory = category.trim();
    if (!name || name.length > MAX_ASSET_NAME_LENGTH) {
      setStatusMessage(
        `Enter an item name of up to ${MAX_ASSET_NAME_LENGTH} characters.`
      );
      return;
    }
    if (cleanCategory.length > MAX_ASSET_CATEGORY_LENGTH) {
      setStatusMessage(
        `Keep the category to ${MAX_ASSET_CATEGORY_LENGTH} characters or fewer.`
      );
      return;
    }
    const stamp = adelaideTimestamp();
    let changed = false;
    const accepted = onMutate(current => {
      if (editor?.mode === "edit") {
        const next = updateAssetRecord(
          current,
          editor.assetId,
          {
            name,
            category: cleanCategory,
            projectId: projectId || null,
          },
          stamp
        );
        changed = next !== current;
        return next;
      }
      const next = addAssetRecord(current, {
        id: makeId("asset"),
        name,
        category: cleanCategory,
        condition: initialCondition,
        status: "active",
        projectId: projectId || null,
        wearLogs: [],
        createdAt: stamp,
        updatedAt: stamp,
      });
      changed = next !== current;
      return next;
    });
    if (!accepted || !changed) {
      setStatusMessage("The Asset was not saved. Check sync, then try again.");
      return;
    }
    setStatusMessage(
      editor?.mode === "edit" ? "Asset details saved." : "Asset added."
    );
    resetAssetEditor();
  }

  function beginAddLog(assetId: string) {
    dictationActive.current = false;
    voice.abort();
    voice.clear();
    setEditingLogId(null);
    setLogTargetAssetId(assetId);
    setLogDate(adelaideClock().date);
    setLogCondition("unknown");
    setLogText("");
    setDraftSource("typed");
    setStatusMessage("");
  }

  function beginEditLog(assetId: string, log: AssetWearLog) {
    dictationActive.current = false;
    voice.abort();
    voice.clear();
    setLogTargetAssetId(assetId);
    setEditingLogId(log.id);
    setLogDate(log.date);
    setLogCondition(log.condition);
    setLogText(log.text);
    setDraftSource("typed");
    setStatusMessage("");
  }

  function cancelLogForm() {
    dictationActive.current = false;
    voice.abort();
    voice.clear();
    setLogTargetAssetId(null);
    setEditingLogId(null);
    setLogText("");
    setDraftSource("typed");
  }

  function startDictation() {
    if (readOnly || !voice.supported) return;
    voice.clear();
    dictationActive.current = true;
    setDraftSource("voice");
    setStatusMessage("");
    voice.start();
  }

  function editLogText(value: string) {
    if (dictationActive.current) {
      dictationActive.current = false;
      voice.abort();
    }
    setDraftSource("typed");
    setLogText(value);
  }

  const voiceTranscriptPending =
    draftSource === "voice" &&
    (voice.listening ||
      Boolean(voice.interimTranscript.trim()) ||
      !voice.finalTranscript.trim() ||
      voice.finalTranscript.trim() !== logText.trim());

  function saveLog(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly || !logTargetAssetId || !isDate(logDate)) return;
    if (voice.listening || voiceTranscriptPending) {
      setStatusMessage(
        "Stop listening and review the final words before saving."
      );
      return;
    }
    const text = logText.trim();
    if (!text || text.length > MAX_ASSET_LOG_TEXT_LENGTH) {
      setStatusMessage(
        `Enter a note of up to ${MAX_ASSET_LOG_TEXT_LENGTH} characters.`
      );
      return;
    }
    const stamp = adelaideTimestamp();
    let changed = false;
    const accepted = onMutate(current => {
      const next = editingLogId
        ? updateAssetWearLog(
            current,
            logTargetAssetId,
            editingLogId,
            { date: logDate, condition: logCondition, text },
            stamp
          )
        : addAssetWearLog(current, logTargetAssetId, {
            id: makeId("wear"),
            date: logDate,
            condition: logCondition,
            text,
            taskId: null,
            createdAt: stamp,
            updatedAt: stamp,
          });
      changed = next !== current;
      return next;
    });
    if (!accepted || !changed) {
      setStatusMessage(
        "The Wear Log was not saved. Check sync or the log limit, then try again."
      );
      return;
    }
    setStatusMessage("Wear Log saved.");
    cancelLogForm();
  }

  function toggleStatus(asset: Asset) {
    const stamp = adelaideTimestamp();
    const accepted = onMutate(current =>
      setAssetStatus(
        current,
        asset.id,
        asset.status === "active" ? "retired" : "active",
        stamp
      )
    );
    if (!accepted)
      setStatusMessage("Status was not changed. Check sync and try again.");
  }

  function confirmDelete() {
    if (!pendingDelete || readOnly) return;
    const target = pendingDelete;
    let changed = false;
    const stamp = adelaideTimestamp();
    const accepted = onMutate(current => {
      const next =
        target.kind === "asset"
          ? removeAssetRecord(current, target.assetId)
          : removeAssetWearLog(current, target.assetId, target.logId, stamp);
      changed = next !== current;
      return next;
    });
    if (!accepted || !changed) {
      setStatusMessage("Nothing was deleted. Check sync and try again.");
      setPendingDelete(null);
      return;
    }
    if (
      editor?.mode === "edit" &&
      target.kind === "asset" &&
      editor.assetId === target.assetId
    ) {
      resetAssetEditor();
    }
    if (logTargetAssetId === target.assetId) cancelLogForm();
    setStatusMessage(
      target.kind === "asset"
        ? "Asset removed. Any linked Tasks remain in All Work."
        : "Wear Log removed. Any linked Task remains in All Work."
    );
    setPendingDelete(null);
  }

  const logTarget = assets.find(asset => asset.id === logTargetAssetId);
  return (
    <section className="assets-page">
      <header className="page-heading assets-heading">
        <div>
          <div className="eyebrow">PHYSICAL ITEMS · MANUAL RECORDS</div>
          <h1>Assets &amp; Wear Logs</h1>
          <p>
            Keep a simple record of owned items and observed condition. Wear
            means physical condition; nothing is sensed or tracked
            automatically.
          </p>
        </div>
        <div className="assets-heading-actions">
          <span className="small muted">
            {assets.length} assets · {totalLogs} logs
          </span>
          <button
            className="button primary"
            type="button"
            onClick={beginNewAsset}
            disabled={readOnly || assets.length >= MAX_ASSETS}
          >
            <Plus size={16} /> Add an asset
          </button>
        </div>
      </header>

      <div className="notice small assets-privacy">
        Assets sync with this workspace and are included in its backups, but
        their names and Wear Log text are excluded from Claude/ChatGPT context.
        Creating a Task from a log is optional: it opens an editable draft and
        creates or links nothing until you confirm <strong>Create task</strong>.
        If you confirm, the resulting Task is ordinary task content and follows
        the existing connector visibility.
      </div>
      {readOnly && (
        <div className="notice small" role="status">
          This shared workspace is read-only while it connects or resolves a
          sync conflict. You can review records but not change them yet.
        </div>
      )}

      {editor && (
        <form className="assets-editor" onSubmit={saveAsset}>
          <h2>{editor.mode === "new" ? "Add an asset" : "Edit asset"}</h2>
          <div className="assets-fields">
            <label className="field">
              <span>Name</span>
              <input
                autoFocus
                value={assetName}
                maxLength={MAX_ASSET_NAME_LENGTH}
                onChange={event => setAssetName(event.target.value)}
                placeholder="e.g. Vacuum cleaner"
                required
                disabled={readOnly}
              />
            </label>
            <label className="field">
              <span>Category (optional)</span>
              <input
                value={category}
                maxLength={MAX_ASSET_CATEGORY_LENGTH}
                onChange={event => setCategory(event.target.value)}
                placeholder="Home, vehicle, tool…"
                disabled={readOnly}
              />
            </label>
            <label className="field">
              <span>Linked project (optional)</span>
              <select
                value={projectId}
                onChange={event => setProjectId(event.target.value)}
                disabled={readOnly}
              >
                <option value="">No project link</option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
            </label>
            {editor.mode === "new" && (
              <label className="field">
                <span>Starting condition</span>
                <select
                  value={initialCondition}
                  onChange={event =>
                    setInitialCondition(event.target.value as AssetCondition)
                  }
                  disabled={readOnly}
                >
                  {ASSET_CONDITIONS.map(condition => (
                    <option key={condition} value={condition}>
                      {CONDITION_LABELS[condition]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="button-row">
            <button
              className="button primary"
              type="submit"
              disabled={readOnly}
            >
              {editor.mode === "new" ? "Save asset" : "Save details"}
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={resetAssetEditor}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="assets-toolbar">
        <label className="field assets-search">
          <span>Search assets and log text</span>
          <input
            type="search"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Filter the register"
          />
        </label>
        <label className="assets-check">
          <input
            type="checkbox"
            checked={showRetired}
            onChange={event => setShowRetired(event.target.checked)}
          />
          Include retired assets
        </label>
      </div>

      {filteredAssets.length === 0 ? (
        <div className="empty-state assets-empty">
          <Package size={22} />
          <h2>
            {assets.length === 0 ? "No assets recorded" : "No matching assets"}
          </h2>
          <p>
            {assets.length === 0
              ? "Add an item when it is useful to keep a condition or maintenance record."
              : "Try a different name or log-text search, or include retired assets."}
          </p>
          {assets.length === 0 && !editor && (
            <button
              className="button secondary"
              onClick={beginNewAsset}
              disabled={readOnly}
            >
              Add your first asset
            </button>
          )}
        </div>
      ) : (
        <div className="accordion-group-list assets-list">
          {assetGroups.map(group => (
            <AccordionSection
              key={group.key}
              persistenceKey={group.key}
              title={group.label}
              count={group.items.length}
              collapsible={filteredAssets.length > 5}
              defaultOpen={group.items.some(
                asset =>
                  asset.status === "active" &&
                  asset.condition === "needs-attention"
              )}
              autoOpen={group.items.some(
                asset =>
                  asset.status === "active" &&
                  asset.condition === "needs-attention"
              )}
              revealToken={search && group.items.length ? search : ""}
              className="assets-category-group"
            >
              <div className="assets-category-list">
                {group.items.map(asset => {
            const linkedProject = projects.find(
              project => project.id === asset.projectId
            );
            const logs = [...asset.wearLogs].sort(
              (a, b) =>
                b.date.localeCompare(a.date) ||
                b.updatedAt.localeCompare(a.updatedAt)
            );
            return (
              <article className="asset-card" key={asset.id}>
                <div className="asset-card-header">
                  <div>
                    <div className="asset-kicker">
                      {asset.category || "Uncategorised"}
                      <span className={`asset-status ${asset.status}`}>
                        {asset.status === "active" ? "Active" : "Retired"}
                      </span>
                    </div>
                    <h2>{asset.name}</h2>
                    <p className="small muted">
                      Current condition:{" "}
                      <strong>{CONDITION_LABELS[asset.condition]}</strong>
                      {linkedProject ? (
                        <> · Project: {linkedProject.title}</>
                      ) : null}
                    </p>
                  </div>
                  <div className="asset-card-actions">
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => beginEditAsset(asset)}
                      disabled={readOnly}
                    >
                      Edit details
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={
                        asset.status === "active"
                          ? `Retire ${asset.name}`
                          : `Restore ${asset.name}`
                      }
                      title={
                        asset.status === "active"
                          ? "Retire asset"
                          : "Restore asset"
                      }
                      onClick={() => toggleStatus(asset)}
                      disabled={readOnly}
                    >
                      {asset.status === "active" ? (
                        <Archive size={16} />
                      ) : (
                        <Undo2 size={16} />
                      )}
                    </button>
                    <button
                      className="icon-button danger"
                      type="button"
                      aria-label={`Delete ${asset.name}`}
                      onClick={() =>
                              setPendingDelete({
                                kind: "asset",
                                assetId: asset.id,
                              })
                      }
                      disabled={readOnly}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="asset-logs-heading">
                  <h3>Condition &amp; use history</h3>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => beginAddLog(asset.id)}
                    disabled={
                      readOnly ||
                      totalLogs >= MAX_ASSET_LOGS_TOTAL ||
                      logs.length >= MAX_ASSET_LOGS_PER_ASSET
                    }
                  >
                    <Plus size={15} /> Add Wear Log
                  </button>
                </div>

                {logTargetAssetId === asset.id && (
                  <form className="asset-log-editor" onSubmit={saveLog}>
                          <h4>
                            {editingLogId ? "Edit Wear Log" : "New Wear Log"}
                          </h4>
                    <div className="assets-fields">
                      <label className="field">
                        <span>Date</span>
                        <input
                          type="date"
                          value={logDate}
                                onChange={event =>
                                  setLogDate(event.target.value)
                                }
                          required
                          disabled={readOnly}
                        />
                      </label>
                      <label className="field">
                        <span>Observed condition</span>
                        <select
                          value={logCondition}
                          onChange={event =>
                            setLogCondition(
                              event.target.value as AssetCondition
                            )
                          }
                          disabled={readOnly}
                        >
                          {ASSET_CONDITIONS.map(condition => (
                            <option key={condition} value={condition}>
                              {CONDITION_LABELS[condition]}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="field">
                      <span>Observation, use or maintenance note</span>
                      <textarea
                        rows={3}
                        value={logText}
                        maxLength={MAX_ASSET_LOG_TEXT_LENGTH}
                              onChange={event =>
                                editLogText(event.target.value)
                              }
                        placeholder="Write a short note; it stays plain text."
                        required
                        disabled={readOnly}
                      />
                    </label>
                    <div className="asset-log-voice">
                      <button
                        className={`button ${voice.listening ? "listening" : "secondary"}`}
                        type="button"
                              onClick={
                                voice.listening ? voice.stop : startDictation
                              }
                        disabled={readOnly || !voice.supported}
                      >
                        {voice.listening ? (
                          <Square size={15} />
                        ) : (
                          <Mic size={15} />
                        )}
                              {voice.listening
                                ? "Stop listening"
                                : "Dictate note"}
                      </button>
                      <span
                        className="small muted"
                        role="status"
                        aria-live="polite"
                      >
                        {voice.listening
                          ? "Listening only because you started it. Stop and review before saving."
                          : voiceTranscriptPending
                            ? "Speech is not final yet; wait for the transcript or edit the text."
                            : "Voice is optional. Nothing is saved until you choose Save log."}
                      </span>
                    </div>
                    {!voice.supported && (
                      <p className="small muted">
                              Speech recognition is not available in this
                              browser; type the note instead.
                      </p>
                    )}
                    {voice.error && (
                      <p className="error" role="alert">
                        {voice.error}
                      </p>
                    )}
                    <div className="button-row">
                      <button
                        className="button primary"
                        type="submit"
                        disabled={
                          readOnly ||
                          !logText.trim() ||
                          voice.listening ||
                          voiceTranscriptPending
                        }
                      >
                        Save log
                      </button>
                      <button
                        className="button secondary"
                        type="button"
                        onClick={cancelLogForm}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {logs.length === 0 ? (
                  <p className="small muted asset-empty-logs">
                    No condition notes yet.
                  </p>
                ) : (
                  <ol className="asset-log-list">
                    {logs.map(log => {
                      const linkedTask = log.taskId
                              ? workspace.tasks.find(
                                  task => task.id === log.taskId
                                )
                        : undefined;
                      return (
                        <li className="asset-log" key={log.id}>
                          <div className="asset-log-meta">
                            <time dateTime={log.date}>
                              {formatDate(log.date)}
                            </time>
                            <span className="asset-condition-pill">
                              {CONDITION_LABELS[log.condition]}
                            </span>
                          </div>
                          <p>{log.text}</p>
                          <div className="asset-log-actions">
                            <button
                              className="button link-button"
                              type="button"
                              onClick={() => beginEditLog(asset.id, log)}
                              disabled={readOnly}
                            >
                              Edit note
                            </button>
                            {linkedTask ? (
                              <button
                                className="button link-button"
                                type="button"
                                onClick={() => onOpenTask(linkedTask)}
                              >
                                Open linked task <ArrowRight size={14} />
                              </button>
                            ) : (
                              <button
                                className="button link-button"
                                type="button"
                                onClick={() =>
                                  onTaskDraft(asset.id, log.id, log.text)
                                }
                                disabled={readOnly}
                              >
                                Create task draft <ArrowRight size={14} />
                              </button>
                            )}
                            <button
                              className="button link-button danger-text"
                              type="button"
                              onClick={() =>
                                setPendingDelete({
                                  kind: "log",
                                  assetId: asset.id,
                                  logId: log.id,
                                })
                              }
                              disabled={readOnly}
                            >
                              Delete log
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </article>
            );
          })}
        </div>
            </AccordionSection>
          ))}
        </div>
      )}

      {statusMessage && (
        <p className="assets-status" role="status" aria-live="polite">
          {statusMessage}
        </p>
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={open => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDelete?.kind === "asset"
                ? "Delete this asset?"
                : "Delete this Wear Log?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.kind === "asset"
                ? "The asset and its condition history will be removed. Any separately confirmed Tasks remain in All Work. This cannot be undone here."
                : "The log will be removed. Any linked Task remains in All Work, unchanged."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingDelete(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={event => {
                event.preventDefault();
                confirmDelete();
              }}
            >
              Delete record
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
