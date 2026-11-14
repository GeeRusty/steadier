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
