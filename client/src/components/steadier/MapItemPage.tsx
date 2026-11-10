import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  ExternalLink,
  Mic,
  Square,
  Volume2,
  X,
} from "lucide-react";
import type { Workspace } from "../../domain/types";
import type { VoiceControls } from "../../hooks/useVoice";
import {
  CHILD_LEVEL,
  GOAL_LEVEL_LABEL,
  GOAL_LEVEL_PLURAL,
  PARENT_LEVEL,
  childrenOf,
  editGoal,
  goalsAt,
  outcomeLastMovement,
  setGoalStatus,
  type Goal,
} from "../../domain/goals";
import {
  addExistingChild,
  addParent,
  addProjectLink,
  confirmGoalLink,
  confirmProjectLink,
  createChildUnder,
  createProjectUnder,
  gapsFor,
  imperativeMapLinks,
  imperativesForGoal,
  linkImperativeToGoal,
  parentLinkStatus,
  removeGoalLink,
  removeProjectLink,
  spokenMapItem,
  unlinkImperativeFromGoal,
} from "../../domain/mapPages";
import { normaliseNotionUrl } from "../../domain/compass";
import {
  hasNativeVoiceDraftHandoff,
  isNativeVoiceDraftEvent,
} from "../../domain/nativeVoice";
import { adelaideTimestamp } from "../../../../shared/time";
import { adelaideClock } from "../../domain/time";

interface Props {
  workspace: Workspace;
  goalId: string;
  onMutate: (fn: (w: Workspace) => Workspace) => boolean | void;
  onOpenGoal: (id: string) => void;
  onOpenProject: (projectId: string) => void;
  onOpenImperatives: () => void;
  onBack: () => void;
  backLabel?: string;
  voice: VoiceControls;
  readOnly: boolean;
}

/** Text input with optional voice dictation (same behaviour as Add to the map). */
function DictateField({
  value,
  onChange,
  voice,
  label,
  placeholder,
  maxLength = 300,
}: {
  value: string;
  onChange: (v: string) => void;
  voice: VoiceControls;
  label: string;
  placeholder?: string;
  maxLength?: number;
}) {
  const [dictating, setDictating] = useState(false);
  const [voiceDraftNote, setVoiceDraftNote] = useState("");
  const base = useRef("");
  const inputRef = useRef<HTMLInputElement>(null);
  const nativeVoiceFallback = hasNativeVoiceDraftHandoff();
  useEffect(() => {
    if (dictating && voice.transcript)
      onChange(
        `${base.current}${base.current ? " " : ""}${voice.transcript}`.slice(
          0,
          maxLength
        )
      );
    // onChange is a fresh closure each render; transcript drives updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.transcript, dictating]);
  useEffect(() => {
    if (dictating && !voice.listening) setDictating(false);
  }, [voice.listening, dictating]);
  const dictate = () => {
    if (voice.listening) return voice.stop();
    base.current = value.trim();
    setVoiceDraftNote("");
    voice.clear();
    setDictating(true);
    voice.start();
  };
  return (
    <div className="notion-row">
      <input
        ref={inputRef}
        value={value}
        maxLength={maxLength}
        aria-label={label}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onInputCapture={event => {
          if (!isNativeVoiceDraftEvent(event.nativeEvent)) return;
          setVoiceDraftNote(
            "Native voice text was inserted into the title only. Review it, then tap Save."
          );
        }}
      />
      {voice.supported ? (
        <button
          type="button"
          className={`button ${dictating && voice.listening ? "listening" : "secondary"} small-button`}
          onClick={dictate}
          aria-label={`Dictate: ${label}`}
        >
          {dictating && voice.listening ? (
            <Square size={14} />
          ) : (
            <Mic size={14} />
          )}
        </button>
      ) : nativeVoiceFallback ? (
        <button
          type="button"
          className="button secondary small-button"
          onClick={() => {
            const input = inputRef.current;
            if (!input) return;
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
            setVoiceDraftNote(
              "Title focused. In the Android app’s Tools/Voice panel, start dictation, review/edit the draft, then tap Place in open field. It inserts text only; Save is still required."
            );
          }}
        >
          <Mic size={14} /> Focus title for app Voice
        </button>
      ) : (
        <span className="small muted">Speech recognition is unavailable.</span>
      )}
      <span className="small muted" role="status" aria-live="polite">
        {voice.listening
          ? "Listening. Review the editable title before saving."
          : voiceDraftNote ||
            (voice.supported
              ? "Optional browser dictation fills an editable draft."
              : nativeVoiceFallback
                ? "Use the app’s opt-in Tools/Voice panel to place an editable draft."
                : "Voice dictation is unavailable in this browser.")}
      </span>
    </div>
  );
}

function StatusTag({ suggested }: { suggested: boolean }) {
  return suggested ? (
    <span className="suggested-chip">suggested</span>
  ) : (
    <span className="small muted">confirmed</span>
  );
}

export default function MapItemPage({
  workspace: initialWorkspace,
  goalId,
  onMutate,
  onOpenGoal,
  onOpenProject,
  onOpenImperatives,
  onBack,
  backLabel = "Compass map",
  voice,
  readOnly,
}: Props) {
  const today = adelaideClock().date;
  const [draftWorkspace, setDraftWorkspace] = useState(initialWorkspace);
  const baseWorkspaceRef = useRef(initialWorkspace);
  const baseWorkspaceSnapshotRef = useRef(JSON.stringify(initialWorkspace));
  const workspace = draftWorkspace;
  const goals = workspace.goals ?? [];
  const goal = goals.find(g => g.id === goalId);
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState(goal?.title ?? "");
  const [description, setDescription] = useState(goal?.description ?? "");
  const [notion, setNotion] = useState(goal?.notionUrl ?? "");
  const [pickParent, setPickParent] = useState("");
  const [pickChild, setPickChild] = useState("");
  const [newChild, setNewChild] = useState("");
  const [pickImperative, setPickImperative] = useState("");

  // Opening another item reuses this component: reset the drafts.
  useEffect(() => {
    setDraftWorkspace(initialWorkspace);
    baseWorkspaceRef.current = initialWorkspace;
    baseWorkspaceSnapshotRef.current = JSON.stringify(initialWorkspace);
    setTitle(goal?.title ?? "");
    setDescription(goal?.description ?? "");
    setNotion(goal?.notionUrl ?? "");
    setPickParent("");
    setPickChild("");
    setNewChild("");
    setPickImperative("");
    setMessage("");
    window.scrollTo?.({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId]);

  if (!goal)
    return (
      <section className="map-page" aria-label="Compass map item">
        <button className="text-button map-back" onClick={onBack}>
          <ArrowLeft size={16} /> {backLabel}
        </button>
        <p>
          This map item is not here any more. It may be in another copy of your
          workspace.
        </p>
      </section>
    );

  const hasPendingEdits =
    draftWorkspace !== baseWorkspaceRef.current ||
    title !== goal.title ||
    description !== goal.description ||
    notion !== (goal.notionUrl ?? "");
  const level = goal.level;
  const parentLevel = PARENT_LEVEL[level];
  const childLevel = CHILD_LEVEL[level];
  const gaps = gapsFor(workspace, goal.id, today);
  const imps = imperativesForGoal(workspace, goal.id);
  const stamp = () => adelaideTimestamp();

  /** Stage an owner change locally; Save is the only workspace write. */
  const act = (
    fn: (w: Workspace) => Workspace,
    done: string,
    unchanged = "Nothing changed: that link already exists."
  ) => {
    if (readOnly) return false;
    const next = fn(workspace);
    const changed = next !== workspace;
    if (changed) setDraftWorkspace(next);
    setMessage(
      changed
        ? `${done} This is a draft; tap Save changes to apply it.`
        : unchanged
    );
    return changed;
  };

  const parents = goal.parents
    .map(l => ({ link: l, g: goals.find(x => x.id === l.id) }))
    .filter(x => x.g) as {
    link: { id: string; confirmed: boolean };
    g: Goal;
  }[];
  const parentCandidates = parentLevel
    ? goalsAt(workspace, parentLevel).filter(
        p => parentLinkStatus(workspace, goal.id, p.id) === "none"
      )
    : [];
  // Children: include suggested links too, so they can be confirmed here.
  const kids = childLevel
    ? goals
        .filter(
          g => g.status === "active" && g.parents.some(l => l.id === goal.id)
        )
        .map(g => ({
          g,
          confirmed: g.parents.find(l => l.id === goal.id)!.confirmed,
        }))
    : [];
  const retiredKids = childLevel
    ? goals.filter(
        g => g.status === "retired" && g.parents.some(l => l.id === goal.id)
      ).length
    : 0;
  const childCandidates = childLevel
    ? goalsAt(workspace, childLevel).filter(
        c => parentLinkStatus(workspace, c.id, goal.id) === "none"
      )
    : [];
  const projects =
    level === "outcome"
      ? goal.projects
          .map(l => ({
            link: l,
            p: workspace.projects.find(x => x.id === l.id),
          }))
          .filter(x => x.p)
      : [];
  const projectCandidates =
    level === "outcome"
      ? workspace.projects.filter(
          p => p.status === "active" && !goal.projects.some(l => l.id === p.id)
        )
      : [];
  const imperativeCandidates = workspace.imperatives.filter(
    i => i.status === "active" && !imperativeMapLinks(i).includes(goal.id)
  );
  const openSteps = (projectId: string) =>
    workspace.tasks.filter(t => t.projectId === projectId && t.state !== "done")
      .length;
  const kidGapCount = (id: string) => gapsFor(workspace, id, today).length;

  const save = () => {
    if (readOnly) return;
    const t = title.trim();
    if (!t) return setMessage("A title is needed.");
    const n = notion.trim() ? normaliseNotionUrl(notion) : null;
    if (notion.trim() && !n)
      return setMessage("Use an https notion.so or notion.site link.");
    const detailsChanged =
      t !== goal.title ||
      description !== goal.description ||
      n !== goal.notionUrl;
    if (!detailsChanged && draftWorkspace === baseWorkspaceRef.current)
      return setMessage("No changes to save.");
    const nextWorkspace = detailsChanged
      ? editGoal(
          draftWorkspace,
          goal.id,
          {
            title: t.slice(0, 300),
            description: description.slice(0, 2000),
            notionUrl: n,
          },
          stamp()
        )
      : draftWorkspace;
    let staleWorkspace = false;
    const ok = onMutate(current => {
      if (JSON.stringify(current) !== baseWorkspaceSnapshotRef.current) {
        staleWorkspace = true;
        return current;
      }
      return nextWorkspace;
    });
    if (staleWorkspace) {
      setMessage(
        "The workspace changed while you were editing. Your draft is still here; refresh, reopen the record, and reapply it."
      );
      return;
    }
    if (ok === false) {
      setMessage(
        "That change was not saved. Check sync and try again; your draft remains here."
      );
      return;
    }
    baseWorkspaceRef.current = nextWorkspace;
    baseWorkspaceSnapshotRef.current = JSON.stringify(nextWorkspace);
    setDraftWorkspace(nextWorkspace);
    setMessage(`Saved “${t}” and all pending Compass changes.`);
  };

  const safeOpenGoal = (id: string) => {
    if (hasPendingEdits) {
      setMessage(
        "Save changes before opening another record; your draft remains here."
      );
      return;
    }
    onOpenGoal(id);
  };
  const safeOpenProject = (id: string) => {
    if (hasPendingEdits) {
      setMessage(
        "Save changes before opening a project; your draft remains here."
      );
      return;
    }
    onOpenProject(id);
  };
  const safeOpenImperatives = () => {
    if (hasPendingEdits) {
      setMessage(
        "Save changes before leaving this record; your draft remains here."
      );
      return;
    }
    onOpenImperatives();
  };
  const safeBack = () => {
    if (hasPendingEdits) {
      setMessage(
        "Save changes before leaving this record; your draft remains here."
      );
      return;
    }
    onBack();
  };

  const read = () =>
    voice.speaking
      ? voice.stopSpeaking()
      : voice.read(spokenMapItem(workspace, goal, today));

  return (
    <section
      className={`map-page level-${level}${goal.status === "retired" ? " retired" : ""}`}
      aria-labelledby="map-page-title"
    >
      <div className="map-page-top">
        <button className="text-button map-back" onClick={safeBack}>
          <ArrowLeft size={16} /> {backLabel}
        </button>
        <div className="map-page-utilities">
          <button
            className="button primary small-button"
            disabled={readOnly || !hasPendingEdits}
            onClick={save}
          >
            Save changes
          </button>
          <button className="text-button" onClick={read}>
            {voice.speaking ? <Square size={15} /> : <Volume2 size={15} />}{" "}
            {voice.speaking ? "Stop" : "Read aloud"}
          </button>
        </div>
      </div>
      <div className="eyebrow">{GOAL_LEVEL_LABEL[level]}</div>
      <h1 id="map-page-title" className="map-page-title">
        {goal.title}
      </h1>
      {goal.status === "retired" && (
        <p className="small muted">Retired on purpose. Kept, not deleted.</p>
      )}

      {gaps.length > 0 && (
        <section className="map-page-gaps" aria-label="Gaps on this item">
          <AlertTriangle size={18} aria-hidden="true" />
          <ul>
            {gaps.map(g => (
              <li key={g.kind}>{g.text}</li>
            ))}
          </ul>
        </section>
      )}

      {parentLevel && (
        <section className="map-page-section" aria-labelledby="sits-under">
          <h2 id="sits-under">Sits under</h2>
          {parents.length === 0 && (
            <p className="small muted">
              Not under any {GOAL_LEVEL_LABEL[parentLevel]} yet.
            </p>
          )}
          <ul className="map-page-rows">
            {parents.map(({ link, g }) => (
              <li key={g.id} className={link.confirmed ? "" : "is-suggested"}>
                <button
                  className="map-row-open"
                  onClick={() => safeOpenGoal(g.id)}
                >
                  <span className="map-level">{GOAL_LEVEL_LABEL[g.level]}</span>
                  <strong>{g.title}</strong>
                  {g.status === "retired" && (
                    <span className="small muted"> retired</span>
                  )}
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
                <div className="map-row-actions">
                  <StatusTag suggested={!link.confirmed} />
                  {!link.confirmed && (
                    <button
                      className="quiet-chip"
                      disabled={readOnly}
                      onClick={() =>
                        act(
                          w => confirmGoalLink(w, goal.id, g.id, stamp()),
                          `Confirmed: sits under “${g.title}”.`,
                          "Nothing changed."
                        )
                      }
                    >
                      <Check size={13} /> Confirm
                    </button>
                  )}
                  <button
                    className="text-button"
                    disabled={readOnly}
                    aria-label={`${link.confirmed ? "Unlink from" : "Reject suggested link to"} ${g.title}`}
                    onClick={() =>
                      act(
                        w => removeGoalLink(w, goal.id, g.id, stamp()),
                        link.confirmed
                          ? `No longer under “${g.title}”.`
                          : `Rejected the suggested link to “${g.title}”.`,
                        "Nothing changed."
                      )
                    }
                  >
                    {link.confirmed ? (
                      "Unlink"
                    ) : (
                      <>
                        <X size={13} /> Reject
                      </>
                    )}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {!readOnly && parentCandidates.length > 0 && (
            <div className="notion-row">
              <select
                value={pickParent}
                onChange={e => setPickParent(e.target.value)}
                aria-label={`Add a ${GOAL_LEVEL_LABEL[parentLevel]} above this`}
              >
                <option value="">Also sits under…</option>
                {parentCandidates.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
              <button
                className="button secondary small-button"
                disabled={!pickParent}
                onClick={() => {
                  const p = goals.find(x => x.id === pickParent);
                  if (
                    act(
                      w => addParent(w, goal.id, pickParent, stamp()),
                      `Now under “${p?.title}”.`
                    )
                  )
                    setPickParent("");
                }}
              >
                Link
              </button>
            </div>
          )}
        </section>
      )}

      <section className="map-page-section" aria-labelledby="details">
        <h2 id="details">Details</h2>
        <label className="field">
          Title
          <DictateField
            value={title}
            onChange={setTitle}
            voice={voice}
            label="Title"
          />
        </label>
        <label className="field">
          What it means (optional)
          <textarea
            rows={3}
            maxLength={2000}
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
        </label>
        <label className="field">
          Notion page link (optional)
          <input
            value={notion}
            placeholder="https://www.notion.so/…"
            onChange={e => setNotion(e.target.value)}
          />
        </label>
        {goal.notionUrl && (
          <a
            className="text-button"
            href={goal.notionUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            <ExternalLink size={14} /> Open in Notion
          </a>
        )}
        <div className="choice-row">
          <button
            className="button primary small-button"
            disabled={readOnly}
            onClick={save}
          >
            Save changes
          </button>
          <button
            className="text-button"
            disabled={readOnly}
            onClick={() =>
              act(
                w =>
                  setGoalStatus(
                    w,
                    goal.id,
                    goal.status === "active" ? "retired" : "active",
                    stamp()
                  ),
                goal.status === "active"
                  ? `Retired “${goal.title}” (kept, not deleted).`
                  : `“${goal.title}” is active again.`
              )
            }
          >
            {goal.status === "active" ? "Retire" : "Make active"}
          </button>
        </div>
        {level === "outcome" && (
          <p className="small muted">
            Last movement: {outcomeLastMovement(workspace, goal) ?? "none yet"}
          </p>
        )}
      </section>

      {childLevel && (
        <section className="map-page-section" aria-labelledby="below">
          <h2 id="below">{GOAL_LEVEL_PLURAL[childLevel]} under this</h2>
          {kids.length === 0 && (
            <p className="small muted">Nothing sits under this yet.</p>
          )}
          <ul className="map-page-rows">
            {kids.map(({ g, confirmed }) => {
              const gapCount = kidGapCount(g.id);
              return (
                <li key={g.id} className={confirmed ? "" : "is-suggested"}>
                  <button
                    className="map-row-open"
                    onClick={() => safeOpenGoal(g.id)}
                  >
                    <strong>{g.title}</strong>
                    <span className="small muted">
                      {g.level === "outcome"
                        ? ` ${g.projects.length} project${g.projects.length === 1 ? "" : "s"}`
                        : ` ${childrenOf(workspace, g.id).length} below`}
                    </span>
                    {gapCount > 0 && (
                      <span className="gap-chip">
                        {gapCount} gap{gapCount === 1 ? "" : "s"}
                      </span>
                    )}
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                  <div className="map-row-actions">
                    <StatusTag suggested={!confirmed} />
                    {!confirmed && (
                      <button
                        className="quiet-chip"
                        disabled={readOnly}
                        onClick={() =>
                          act(
                            w => confirmGoalLink(w, g.id, goal.id, stamp()),
                            `Confirmed “${g.title}” under this.`,
                            "Nothing changed."
                          )
                        }
                      >
                        <Check size={13} /> Confirm
                      </button>
                    )}
                    <button
                      className="text-button"
                      disabled={readOnly}
                      aria-label={`${confirmed ? "Unlink" : "Reject suggested"} ${g.title}`}
                      onClick={() =>
                        act(
                          w => removeGoalLink(w, g.id, goal.id, stamp()),
                          confirmed
                            ? `“${g.title}” no longer sits under this.`
                            : `Rejected the suggested link from “${g.title}”.`,
                          "Nothing changed."
                        )
                      }
                    >
                      {confirmed ? (
                        "Unlink"
                      ) : (
                        <>
                          <X size={13} /> Reject
                        </>
                      )}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {retiredKids > 0 && (
            <p className="small muted">
              {retiredKids} retired item{retiredKids === 1 ? "" : "s"} also
              linked here (hidden).
            </p>
          )}
          {!readOnly && (
            <>
              {childCandidates.length > 0 && (
                <div className="notion-row">
                  <select
                    value={pickChild}
                    onChange={e => setPickChild(e.target.value)}
                    aria-label={`Add an existing ${GOAL_LEVEL_LABEL[childLevel]}`}
                  >
                    <option value="">
                      Add existing {GOAL_LEVEL_LABEL[childLevel]}…
                    </option>
                    {childCandidates.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                  <button
                    className="button secondary small-button"
                    disabled={!pickChild}
                    onClick={() => {
                      const c = goals.find(x => x.id === pickChild);
                      if (
                        act(
                          w => addExistingChild(w, goal.id, pickChild, stamp()),
                          `Added “${c?.title}” under this.`
                        )
                      )
                        setPickChild("");
                    }}
                  >
                    Add
                  </button>
                </div>
              )}
              <label className="field">
                New {GOAL_LEVEL_LABEL[childLevel]} under this
                <DictateField
                  value={newChild}
                  onChange={setNewChild}
                  voice={voice}
                  label={`New ${GOAL_LEVEL_LABEL[childLevel]} title`}
                />
              </label>
              <button
                className="button secondary small-button"
                disabled={!newChild.trim()}
                onClick={() => {
                  const t = newChild.trim();
                  if (
                    act(
                      w => createChildUnder(w, goal.id, t, stamp()).workspace,
                      `Added new ${GOAL_LEVEL_LABEL[childLevel]} “${t}” under this.`
                    )
                  )
                    setNewChild("");
                }}
              >
                Add new
              </button>
            </>
          )}
        </section>
      )}

      {level === "outcome" && (
        <section className="map-page-section" aria-labelledby="served-by">
          <h2 id="served-by">Projects serving this</h2>
          {projects.length === 0 && (
            <p className="small muted">No project serves this Outcome yet.</p>
          )}
          <ul className="map-page-rows">
            {projects.map(({ link, p }) => (
              <li key={p!.id} className={link.confirmed ? "" : "is-suggested"}>
                <button
                  className="map-row-open"
                  onClick={() => safeOpenProject(p!.id)}
                >
                  <span className="map-level">Project</span>
                  <strong>{p!.title}</strong>
                  <span className="small muted">
                    {" "}
                    {p!.status} · {openSteps(p!.id)} open step
                    {openSteps(p!.id) === 1 ? "" : "s"}
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
                <div className="map-row-actions">
                  <StatusTag suggested={!link.confirmed} />
                  {!link.confirmed && (
                    <button
                      className="quiet-chip"
                      disabled={readOnly}
                      onClick={() =>
                        act(
                          w => confirmProjectLink(w, goal.id, p!.id, stamp()),
                          `Confirmed “${p!.title}”.`,
                          "Nothing changed."
                        )
                      }
                    >
                      <Check size={13} /> Confirm
                    </button>
                  )}
                  <button
                    className="text-button"
                    disabled={readOnly}
                    onClick={() =>
                      act(
                        w => removeProjectLink(w, goal.id, p!.id, stamp()),
                        link.confirmed
                          ? `Unlinked “${p!.title}”.`
                          : `Rejected the suggested project “${p!.title}”.`,
                        "Nothing changed."
                      )
                    }
                  >
                    {link.confirmed ? (
                      "Unlink"
                    ) : (
                      <>
                        <X size={13} /> Reject
                      </>
                    )}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {!readOnly && (
            <>
              {projectCandidates.length > 0 && (
                <div className="notion-row">
                  <select
                    value={pickChild}
                    onChange={e => setPickChild(e.target.value)}
                    aria-label="Add an existing project"
                  >
                    <option value="">Add existing project…</option>
                    {projectCandidates.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                  <button
                    className="button secondary small-button"
                    disabled={!pickChild}
                    onClick={() => {
                      const p = workspace.projects.find(
                        x => x.id === pickChild
                      );
                      if (
                        act(
                          w => addProjectLink(w, goal.id, pickChild, stamp()),
                          `Linked “${p?.title}”.`
                        )
                      )
                        setPickChild("");
                    }}
                  >
                    Add
                  </button>
                </div>
              )}
              <label className="field">
                New project for this Outcome
                <DictateField
                  value={newChild}
                  onChange={setNewChild}
                  voice={voice}
                  label="New project title"
                />
              </label>
              <button
                className="button secondary small-button"
                disabled={!newChild.trim()}
                onClick={() => {
                  const t = newChild.trim();
                  if (
                    act(
                      w => createProjectUnder(w, goal.id, t, stamp()).workspace,
                      `Created project “${t}”. Choose its role and pattern on the project.`
                    )
                  )
                    setNewChild("");
                }}
              >
                Create project
              </button>
            </>
          )}
        </section>
      )}

      <section className="map-page-section" aria-labelledby="imps">
        <h2 id="imps">Imperatives</h2>
        {imps.direct.length === 0 && imps.through.length === 0 && (
          <p className="small muted">No Imperative reaches this item.</p>
        )}
        <ul className="map-page-rows">
          {imps.direct.map(i => (
            <li key={i.id}>
              <button className="map-row-open" onClick={safeOpenImperatives}>
                <span className="map-level">Imperative</span>
                <strong>{i.title}</strong>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
              <div className="map-row-actions">
                <span className="small muted">linked here</span>
                <button
                  className="text-button"
                  disabled={readOnly}
                  onClick={() =>
                    act(
                      w => unlinkImperativeFromGoal(w, i.id, goal.id, stamp()),
                      `Unlinked Imperative “${i.title}”.`,
                      "Nothing changed."
                    )
                  }
                >
                  Unlink
                </button>
              </div>
            </li>
          ))}
          {imps.through.map(i => (
            <li key={i.id}>
              <button className="map-row-open" onClick={safeOpenImperatives}>
                <span className="map-level">Imperative</span>
                <strong>{i.title}</strong>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
              <div className="map-row-actions">
                <span className="small muted">through items or work below</span>
              </div>
            </li>
          ))}
        </ul>
        {!readOnly && imperativeCandidates.length > 0 && (
          <div className="notion-row">
            <select
              value={pickImperative}
              onChange={e => setPickImperative(e.target.value)}
              aria-label="Link an Imperative here"
            >
              <option value="">Link an Imperative here…</option>
              {imperativeCandidates.map(i => (
                <option key={i.id} value={i.id}>
                  {i.title}
                </option>
              ))}
            </select>
            <button
              className="button secondary small-button"
              disabled={!pickImperative}
              onClick={() => {
                const i = workspace.imperatives.find(
                  x => x.id === pickImperative
                );
                if (
                  act(
                    w =>
                      linkImperativeToGoal(w, pickImperative, goal.id, stamp()),
                    `Linked Imperative “${i?.title}” here.`
                  )
                )
                  setPickImperative("");
              }}
            >
              Link
            </button>
          </div>
        )}
      </section>

      <details className="map-page-section map-page-history">
        <summary>Change log ({goal.history.length})</summary>
        <ul className="small">
          {[...goal.history]
            .reverse()
            .slice(0, 30)
            .map((h, n) => (
              <li key={`${h.at}-${n}`}>
                <span className="muted">
                  {h.at.slice(0, 16).replace("T", " ")}
                </span>{" "}
                {h.text}
              </li>
            ))}
        </ul>
      </details>

      {message && (
        <p className="small map-page-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
