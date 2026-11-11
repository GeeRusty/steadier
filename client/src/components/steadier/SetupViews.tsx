import React, { useMemo, useState } from "react";
import { ArrowRight, Check, Lightbulb, RotateCcw, SkipForward } from "lucide-react";
import { friendlyDate } from "../../domain/quickParse";
import { datedForToday, ideas, isFaded, letGoIdeas, notReadyTasks } from "../../domain/taskCard";
import type { Task, Workspace } from "../../domain/types";
import type { VoiceControls } from "../../hooks/useVoice";
import CardDotsMark from "./CardDotsMark";
import TaskCard, { type CardChange } from "./TaskCard";

// ---------------------------------------------------------------------------
// Sort: one faded card at a time.

export function SortView({
  workspace,
  today,
  readOnly,
  voice,
  onApply,
  onFinish,
}: {
  workspace: Workspace;
  today: string;
  readOnly: boolean;
  voice?: VoiceControls;
  onApply: (taskId: string, change: CardChange) => boolean;
  onFinish: () => void;
}) {
  // The list is fixed when Sort opens, so a card stays put while it turns solid.
  const [queue] = useState(() => notReadyTasks(workspace.tasks).map(t => t.id));
  const [passed, setPassed] = useState<Set<string>>(new Set());
  const remaining = queue.filter(id => !passed.has(id) && workspace.tasks.some(t => t.id === id));
  const current = workspace.tasks.find(t => t.id === remaining[0]);

  if (!queue.length || !current) {
    return (
      <section className="sort-view sort-view--empty" aria-labelledby="sort-title">
        <h1 id="sort-title" className="page-purpose-heading">Sort</h1>
        <p className="sort-empty"><Check size={20} aria-hidden="true" /> {queue.length ? "All sorted." : "Nothing to sort. Every task is set up."}</p>
        <button type="button" className="card-btn card-btn--main card-btn--wide" onClick={onFinish}>
          Back to Today <ArrowRight size={18} aria-hidden="true" />
        </button>
      </section>
    );
  }

  const position = queue.length - remaining.length + 1;
  const next = () => {
    if (remaining.length <= 1) onFinish();
    else setPassed(prev => new Set(prev).add(current.id));
  };

  return (
    <section className="sort-view" aria-labelledby="sort-title">
      <div className="sort-head">
        <h1 id="sort-title" className="page-purpose-heading">Sort</h1>
        <span className="sort-count">{position} of {queue.length}</span>
      </div>
      <p className="small muted">Light the three dots: Action, Place and First step. A date is optional. Skip anything you're not sure about.</p>
      <TaskCard
        key={current.id}
        task={current}
        workspace={workspace}
        today={today}
        readOnly={readOnly}
        voice={voice}
        sortMode
        onApply={change => onApply(current.id, change)}
      />
      <div className="sort-actions">
        <button type="button" className="card-btn card-btn--wide" onClick={next}>
          <SkipForward size={18} aria-hidden="true" /> Skip
        </button>
        <button type="button" className="card-btn card-btn--main card-btn--wide" onClick={next}>
          <Check size={18} aria-hidden="true" /> Done
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Ideas shelf (and the Weekly Review Ideas step).

export function IdeasShelf({
  tasks,
  readOnly,
  reviewMode = false,
  onMakeTask,
  onKeep,
  onLetGo,
  onBringBack,
  onAddIdea,
}: {
  tasks: Task[];
  readOnly: boolean;
  reviewMode?: boolean;
  onMakeTask: (id: string) => boolean;
  onKeep: (id: string) => boolean;
  onLetGo: (id: string) => boolean;
  onBringBack: (id: string) => boolean;
  onAddIdea?: (title: string) => boolean;
}) {
  const shelf = ideas(tasks);
  const gone = letGoIdeas(tasks);
  const [draft, setDraft] = useState("");
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [showGone, setShowGone] = useState(false);
  const list = reviewMode ? shelf.filter(t => !kept.has(t.id)) : shelf;

  return (
    <section className="ideas-shelf" aria-labelledby="ideas-title">
      {!reviewMode && <h1 id="ideas-title" className="page-purpose-heading"><Lightbulb size={22} aria-hidden="true" /> Ideas</h1>}
      {reviewMode && <h3 id="ideas-title">Ideas ({shelf.length})</h3>}
      <p className="small muted">
        {reviewMode
          ? "One tap each: make it a task, keep it on the shelf, or let it go. Let go is archived, never deleted."
          : "Things you might do one day. No timers and no warnings. Make one a task when you're ready."}
      </p>
      {onAddIdea && !reviewMode && (
        <form
          className="task-card-inline ideas-add"
          onSubmit={event => {
            event.preventDefault();
            if (draft.trim() && onAddIdea(draft.trim())) setDraft("");
          }}
        >
          <input aria-label="New idea" value={draft} maxLength={500} placeholder="Add an idea" disabled={readOnly} onChange={e => setDraft(e.target.value)} />
          <button type="submit" className="card-btn card-btn--main" disabled={readOnly || !draft.trim()}>Add</button>
        </form>
      )}
      {list.length === 0 ? (
        <p className="ideas-empty">{reviewMode && shelf.length ? "All ideas looked at." : "No ideas on the shelf."}</p>
      ) : (
        <ul className="ideas-list">
          {list.map(idea => (
            <li key={idea.id} className="idea-card">
              <strong>{idea.title}</strong>
              {idea.notes.trim() && <p className="small muted">{idea.notes}</p>}
              <div className="idea-actions">
                <button type="button" className="card-btn card-btn--main" disabled={readOnly} onClick={() => onMakeTask(idea.id)}>Make it a task</button>
                <button
                  type="button"
                  className="card-btn"
                  disabled={readOnly}
                  onClick={() => {
                    if (onKeep(idea.id)) setKept(prev => new Set(prev).add(idea.id));
                  }}
                >
                  Keep
                </button>
                <button type="button" className="card-btn card-btn--quiet" disabled={readOnly} onClick={() => onLetGo(idea.id)}>Let go</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {gone.length > 0 && (
        <div className="ideas-gone">
          <button type="button" className="text-button" onClick={() => setShowGone(v => !v)}>
            {showGone ? "Hide" : "Show"} ideas you let go ({gone.length})
          </button>
          {showGone && (
            <ul className="ideas-list ideas-list--gone">
              {gone.map(idea => (
                <li key={idea.id} className="idea-card is-gone">
                  <span>{idea.title}</span>
                  <button type="button" className="card-btn" disabled={readOnly} onClick={() => onBringBack(idea.id)}>
                    <RotateCcw size={16} aria-hidden="true" /> Bring back
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Today: dates always win.

export function DatedTodayCard({
  tasks,
  today,
  onOpen,
}: {
  tasks: Task[];
  today: string;
  onOpen: (task: Task) => void;
}) {
  const dated = useMemo(() => datedForToday(tasks, today), [tasks, today]);
  if (!dated.length) return null;
  const when = (t: Task) => {
    const parts: string[] = [];
    const tag = (label: string, d: string | null | undefined) => {
      if (d && d <= today) parts.push(d < today ? `${label} ${friendlyDate(d, today)} (overdue)` : `${label} today`);
    };
    tag("Planned", t.schedule.date);
    tag("Deadline", t.deadline);
    tag("Prepare", t.preparationDate);
    return parts.join(" · ");
  };
  return (
    <section className="dated-today" aria-labelledby="dated-today-title">
      <h2 id="dated-today-title" className="lbl">Dated for today or overdue ({dated.length})</h2>
      <ul>
        {dated.map(task => {
          const faded = isFaded(task, tasks);
          return (
            <li key={task.id} className={`dated-row${faded ? " is-faded" : ""}`}>
              <button type="button" className="dated-main" onClick={() => onOpen(task)}>
                <strong>{task.title}</strong>
                <span className="small muted">{when(task)}</span>
              </button>
              {faded ? (
                <button type="button" className="card-btn card-btn--main" onClick={() => onOpen(task)}>
                  Set up <CardDotsMark task={task} tasks={tasks} />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
