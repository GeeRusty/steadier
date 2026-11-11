import React, { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Mic, MicOff, Pencil } from "lucide-react";
import { CATCH_ALL_LABEL } from "../../domain/compass";
import { friendlyDate } from "../../domain/quickParse";
import {
  cardDots,
  isSetUp,
  looksLikeAction,
  placeChoices,
  placeLabel,
  setActionConfirmed,
  setCardTitle,
  setFirstStep,
  setPlace,
  setUpReason,
  setWhen,
  titleIsStep,
  type CardPlace,
} from "../../domain/taskCard";
import type { Task, Workspace } from "../../domain/types";
import type { VoiceControls } from "../../hooks/useVoice";
import { adelaideTimestamp } from "../../../../shared/time";
import CardDotsMark from "./CardDotsMark";

export type CardChange = (task: Task, all: Task[]) => Task;

interface Props {
  task: Task;
  workspace: Workspace;
  today: string;
  readOnly?: boolean;
  voice?: VoiceControls;
  /** Apply one change to the saved task. Returns false when it was not saved. */
  onApply: (change: CardChange) => boolean;
  /** Sort mode: Place choices are always open and buttons are larger. */
  sortMode?: boolean;
  /** Everything else about the task, collapsed under "More". */
  more?: ReactNode;
  moreOpen?: boolean;
}

/**
 * The one task card, used in Sort, the task view and anywhere a task is set
 * up. Action, Place and First step each have a dot; When is optional.
 */
export default function TaskCard({ task, workspace, today, readOnly = false, voice, onApply, sortMode = false, more, moreOpen = false }: Props) {
  const all = workspace.tasks;
  const dots = cardDots(task, all);
  const ready = isSetUp(task, all);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [choosingPlace, setChoosingPlace] = useState(false);
  const [stepDraft, setStepDraft] = useState(task.nextAction);
  const [editingStep, setEditingStep] = useState(!task.nextAction.trim());
  const [editingWhen, setEditingWhen] = useState(false);
  const [dictating, setDictating] = useState(false);
  const choices = useMemo(() => placeChoices(workspace), [workspace]);
  const otherProjects = workspace.projects.filter(p => p.status === "active" && !choices.projects.some(c => c.id === p.id));

  // A new task in Sort starts fresh.
  useEffect(() => {
    setTitleDraft(task.title);
    setStepDraft(task.nextAction);
    setEditingStep(!task.nextAction.trim());
    setEditingTitle(false);
    setChoosingPlace(false);
    setEditingWhen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  // Dictation for First step: fill the box when speech finishes.
  useEffect(() => {
    if (!dictating || !voice || voice.listening) return;
    const heard = voice.finalTranscript.trim();
    if (heard) {
      setStepDraft(heard);
      setEditingStep(true);
      voice.clear();
      setDictating(false);
    } else if (voice.error) {
      setDictating(false);
    }
  }, [dictating, voice, voice?.listening, voice?.finalTranscript, voice?.error]);

  const stamp = () => adelaideTimestamp();
  const apply = (change: CardChange) => (readOnly ? false : onApply(change));
  const projects = workspace.projects;
  const place = placeLabel(task, projects);
  const showPlaceChoices = sortMode ? !dots.place || choosingPlace : choosingPlace || !dots.place;

  const choosePlace = (choice: CardPlace) => {
    if (apply((t, tasks) => setPlace(t, choice, stamp(), tasks, projects))) setChoosingPlace(false);
  };
  const saveStep = () => {
    if (apply((t, tasks) => setFirstStep(t, stepDraft, stamp(), tasks)) && stepDraft.trim()) setEditingStep(false);
  };
  const actionHint = looksLikeAction(task.title);

  return (
    <article className={`task-card${ready ? " is-solid" : " is-faded"}${sortMode ? " task-card--sort" : ""}`} aria-label={`Task card: ${task.title}`}>
      <header className="task-card-head">
        <CardDotsMark task={task} tasks={all} showLabels />
        <span className={`task-card-status${ready ? " is-ready" : ""}`}>{ready ? "Ready" : `Not ready · ${setUpReason(task, all)}`}</span>
      </header>

      {/* Action */}
      <section className="task-card-row" aria-label="Action">
        <span className={`card-dot${dots.action ? " is-lit" : ""}`} aria-hidden="true" />
        <div className="task-card-row-body">
          <span className="task-card-label">Action</span>
          {editingTitle ? (
            <form
              className="task-card-inline"
              onSubmit={event => {
                event.preventDefault();
                if (apply((t, tasks) => setCardTitle(t, titleDraft, stamp(), tasks))) setEditingTitle(false);
              }}
            >
              <input aria-label="Task title" value={titleDraft} maxLength={500} onChange={e => setTitleDraft(e.target.value)} autoFocus />
              <button type="submit" className="card-btn" disabled={readOnly || !titleDraft.trim()}>Save</button>
            </form>
          ) : (
            <button type="button" className="task-card-title" onClick={() => setEditingTitle(true)} disabled={readOnly}>
              <strong>{task.title}</strong> <Pencil size={14} aria-hidden="true" />
            </button>
          )}
          {!dots.action ? (
            <div className="task-card-actions">
              <button type="button" className="card-btn card-btn--main" disabled={readOnly} onClick={() => apply((t, tasks) => setActionConfirmed(t, true, stamp(), tasks))}>
                <Check size={18} aria-hidden="true" /> It's an action
              </button>
              <span className="task-card-hint">{actionHint ? "Reads like an action." : "Tip: start with a doing word, like “Call…” or “Book…”."}</span>
            </div>
          ) : !editingTitle && (
            <button type="button" className="text-button task-card-undo" disabled={readOnly} onClick={() => apply((t, tasks) => setActionConfirmed(t, false, stamp(), tasks))}>
              Not an action yet
            </button>
          )}
        </div>
      </section>

      {/* Place */}
      <section className="task-card-row" aria-label="Place">
        <span className={`card-dot${dots.place ? " is-lit" : ""}`} aria-hidden="true" />
        <div className="task-card-row-body">
          <span className="task-card-label">Place</span>
          {dots.place && !choosingPlace && (
            <div className="task-card-value">
              <span>{place ?? "Placed"}</span>
              <button type="button" className="text-button" disabled={readOnly} onClick={() => setChoosingPlace(true)}>Change</button>
            </div>
          )}
          {!dots.place && task.compass.projectSuggested && task.projectId && (
            <p className="task-card-hint">Suggested: {projects.find(p => p.id === task.projectId)?.title}. Tap it below to confirm.</p>
          )}
          {showPlaceChoices && (
            <div className="task-card-choices" role="group" aria-label="Choose a place">
              {choices.projects.map(project => (
                <button key={project.id} type="button" className={`card-btn${task.projectId === project.id ? " is-picked" : ""}`} disabled={readOnly} onClick={() => choosePlace({ kind: "project", projectId: project.id })}>
                  {project.title}
                </button>
              ))}
              {choices.catchAlls.map(c => (
                <button key={c} type="button" className={`card-btn card-btn--catchall${task.compass.catchAll === c && task.compass.catchAllConfirmed ? " is-picked" : ""}`} disabled={readOnly} onClick={() => choosePlace({ kind: "catch-all", catchAll: c })}>
                  {CATCH_ALL_LABEL[c]}
                </button>
              ))}
              {otherProjects.length > 0 && (
                <select
                  className="card-select"
                  aria-label="Other project"
                  value=""
                  disabled={readOnly}
                  onChange={e => e.target.value && choosePlace({ kind: "project", projectId: e.target.value })}
                >
                  <option value="">Other project…</option>
                  {otherProjects.map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              )}
              {choosingPlace && (
                <button type="button" className="text-button" onClick={() => setChoosingPlace(false)}>Cancel</button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* First step */}
      <section className="task-card-row" aria-label="First step">
        <span className={`card-dot${dots.step ? " is-lit" : ""}`} aria-hidden="true" />
        <div className="task-card-row-body">
          <span className="task-card-label">First step</span>
          {!editingStep && dots.step ? (
            <div className="task-card-value">
              <span>{task.nextAction === task.title ? "The title is the step" : task.nextAction}</span>
              <button type="button" className="text-button" disabled={readOnly} onClick={() => { setStepDraft(task.nextAction); setEditingStep(true); }}>Change</button>
            </div>
          ) : (
            <>
              <form className="task-card-inline" onSubmit={event => { event.preventDefault(); saveStep(); }}>
                <input
                  aria-label="First step"
                  value={stepDraft}
                  maxLength={2000}
                  placeholder="One small physical action, e.g. find the rego papers"
                  disabled={readOnly}
                  onChange={e => setStepDraft(e.target.value)}
                />
                {voice?.supported && (
                  <button
                    type="button"
                    className={`card-btn card-btn--icon${dictating ? " is-listening" : ""}`}
                    aria-label={dictating ? "Stop listening" : "Say the first step"}
                    disabled={readOnly}
                    onClick={() => {
                      if (dictating) {
                        voice.stop();
                        return;
                      }
                      voice.clear();
                      setDictating(true);
                      voice.start();
                    }}
                  >
                    {dictating ? <MicOff size={20} /> : <Mic size={20} />}
                  </button>
                )}
                <button type="submit" className="card-btn card-btn--main" disabled={readOnly || !stepDraft.trim()}>Save</button>
              </form>
              <div className="task-card-actions">
                <button type="button" className="card-btn" disabled={readOnly} onClick={() => { if (apply((t, tasks) => titleIsStep(t, stamp(), tasks))) setEditingStep(false); }}>
                  Title is the step
                </button>
                {dots.step && (
                  <button type="button" className="text-button" onClick={() => setEditingStep(false)}>Cancel</button>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {/* When (optional, no dot) */}
      <section className="task-card-row task-card-row--when" aria-label="When">
        <span className="card-dot card-dot--none" aria-hidden="true" />
        <div className="task-card-row-body">
          <span className="task-card-label">When <span className="task-card-optional">optional</span></span>
          {editingWhen ? (
            <div className="task-card-when">
              <label>
                Planned day
                <input type="date" value={task.schedule.date ?? ""} disabled={readOnly} onChange={e => apply((t, tasks) => setWhen(t, { date: e.target.value || null }, stamp(), tasks))} />
              </label>
              <label>
                Deadline
                <input type="date" value={task.deadline ?? ""} disabled={readOnly} onChange={e => apply((t, tasks) => setWhen(t, { deadline: e.target.value || null }, stamp(), tasks))} />
              </label>
              <button type="button" className="text-button" onClick={() => setEditingWhen(false)}>Done</button>
            </div>
          ) : (
            <div className="task-card-value">
              <span>
                {[
                  task.schedule.date ? `Planned ${friendlyDate(task.schedule.date, today)}${task.schedule.time ? ` at ${task.schedule.time}` : ""}` : null,
                  task.deadline ? `Deadline ${friendlyDate(task.deadline, today)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "No date"}
              </span>
              <button type="button" className="text-button" disabled={readOnly} onClick={() => setEditingWhen(true)}>{task.schedule.date || task.deadline ? "Change" : "Add"}</button>
            </div>
          )}
        </div>
      </section>

      {more && (
        <details className="task-card-more" open={moreOpen}>
          <summary>More</summary>
          <div className="task-card-more-body">{more}</div>
        </details>
      )}
    </article>
  );
}
