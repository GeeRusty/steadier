import React, { useMemo, useState } from "react";
import type { Task, Workspace } from "../../domain/types";
import { poolTasks, passOverThreshold, taskPassOvers, pastDueTasks } from "../../domain/anchorPlanning";
import { parentOf } from "../../domain/subtasks";
import V2FoldableCard from "./V2FoldableCard";

interface Props {
  workspace: Workspace;
  tasks: Task[];
  day: string;
  minute: number;
  readOnly: boolean;
  onChoose: (taskId: string, when: string, doAction: string) => boolean;
  onDone: (taskId: string) => boolean;
  onNotNow: (taskId: string) => boolean;
  onStillOn: (taskId: string) => boolean;
  onDrop: (taskId: string) => boolean;
  /** Opens All work filtered to past-due items. Display only. */
  onOpenPastDue?: () => void;
  /** Optional read-only content between the primary Next thing and Pool cards. */
  afterNextThing?: React.ReactNode;
}

export default function TodayNextThing({
  workspace,
  tasks,
  day,
  minute,
  readOnly,
  onChoose,
  onDone,
  onNotNow,
  onStillOn,
  onDrop,
  onOpenPastDue,
  afterNextThing,
}: Props) {
  const [choosingId, setChoosingId] = useState<string | null>(null);
  const [editingSelected, setEditingSelected] = useState(false);
  const [whenDraft, setWhenDraft] = useState("");
  const [doDraft, setDoDraft] = useState("");
  const [status, setStatus] = useState("");
  const pastDueCount = useMemo(
    () => pastDueTasks(tasks, day).length,
    [tasks, day]
  );
  const available = useMemo(
    () => poolTasks(tasks, day, minute),
    [tasks, day, minute]
  );
  const selected = workspace.nextThing?.date === day
    ? available.find(task => task.id === workspace.nextThing?.taskId)
    : undefined;
  const parent = selected ? parentOf(tasks, selected) : undefined;
  const candidates = available.filter(task => task.id !== selected?.id);
  const threshold = passOverThreshold(workspace);

  function beginChoose(task: Task, editCurrent = false) {
    setChoosingId(task.id);
    setEditingSelected(editCurrent);
    setWhenDraft(editCurrent ? workspace.nextThing?.when || "" : "");
    setDoDraft(task.nextAction.trim());
    setStatus("");
    window.setTimeout(() => document.getElementById("next-thing-when")?.focus(), 0);
  }

  function cancelChoice() {
    setChoosingId(null);
    setEditingSelected(false);
    setWhenDraft("");
    setDoDraft("");
  }

  function saveChoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!choosingId || !whenDraft.trim() || !doDraft.trim()) {
      setStatus("Add both a WHEN trigger and one small physical DO action.");
      return;
    }
    if (onChoose(choosingId, whenDraft.trim(), doDraft.trim())) {
      cancelChoice();
      setStatus("Next thing saved. The task remains untimed.");
    } else {
      setStatus("That choice was not saved. Check sync and try again.");
    }
  }

  function choiceForm(taskId: string) {
    const task = tasks.find(item => item.id === taskId);
    const reviewPrompt = task ? taskPassOvers(task) >= threshold : false;
    return (
      <form className="next-thing-choice-form" onSubmit={saveChoice}>
        <p className="next-thing-choice-task"><strong>{task?.title}</strong></p>
        <label className="field" htmlFor="next-thing-when">
          WHEN — a trigger in your own words
          <input
            id="next-thing-when"
            value={whenDraft}
            maxLength={300}
            autoComplete="off"
            placeholder="e.g. after breakfast, when I get home"
            onChange={event => setWhenDraft(event.target.value)}
            disabled={readOnly}
            required
          />
          <span className="small muted">
            On Android, open the app’s Tools → Voice panel and tap “Place in open field” to insert a reviewed draft here.
          </span>
        </label>
        <label className="field" htmlFor="next-thing-do">
          DO — one small physical first action
          <input
            id="next-thing-do"
            value={doDraft}
            maxLength={500}
            autoComplete="off"
            placeholder="e.g. put the form and pen on the table"
            onChange={event => setDoDraft(event.target.value)}
            disabled={readOnly}
            required
          />
        </label>
        {reviewPrompt && (
          <div className="pass-over-prompt" role="group" aria-label={`Still on, or dropped: ${task?.title}`}>
            <span>Still on, or dropped?</span>
            <button type="button" className="text-button" disabled={readOnly} onClick={() => onStillOn(taskId)}>Still on</button>
            <button type="button" className="text-button" disabled={readOnly} onClick={() => onDrop(taskId)}>Dropped</button>
          </div>
        )}
        <div className="next-thing-actions">
          <button type="submit" className="button primary small-button" disabled={readOnly}>Save WHEN and DO</button>
          <button type="button" className="text-button" onClick={cancelChoice}>Cancel</button>
        </div>
      </form>
    );
  }

  return (
    <div className="today-next-pool v2-next-pool">
      <V2FoldableCard
        title="Next thing"
        storageKey="today-next-thing"
        defaultOpen
        className="v2-next-card"
      >
        <div className="v2-next-content" aria-live="polite">
          {selected && choosingId === selected.id ? (
            choiceForm(selected.id)
          ) : selected ? (
            <>
              <div className="next-thing-fields v2-next-fields">
                <button type="button" className="v2-next-when" onClick={() => beginChoose(selected, true)}>
                  <strong>When</strong> {workspace.nextThing?.when || "Add a trigger"}
                </button>
                <button
                  type="button"
                  className="next-thing-title v2-next-title"
                  onClick={() => beginChoose(selected, true)}
                  aria-label={`Edit the DO action for ${selected.title}`}
                >
                  {selected.nextAction.trim() || "Add one small physical first action."}
                </button>
                <p className="v2-next-for">
                  for: {parent?.title || selected.title}
                </p>
              </div>
              <div className="next-thing-actions v2-next-actions">
                <button
                  type="button"
                  className="button primary small-button"
                  disabled={readOnly}
                  onClick={() => setStatus(onDone(selected.id) ? "Done." : "It was not saved. Check sync and try again.")}
                >
                  Done
                </button>
                <button
                  type="button"
                  className="button secondary small-button"
                  disabled={readOnly}
                  onClick={() => setStatus(onNotNow(selected.id) ? "Returned to the untimed pool. No penalty." : "It was not saved. Check sync and try again.")}
                >
                  Not now
                </button>
              </div>
            </>
          ) : choosingId && editingSelected ? (
            choiceForm(choosingId)
          ) : (
            <p className="small muted">No task chosen. Choose a task from Pool when you’re ready.</p>
          )}
          {status && <p className="small" role="status">{status}</p>}
        </div>
      </V2FoldableCard>

      {afterNextThing}

      <V2FoldableCard
        title="Pool"
        count={candidates.length}
        storageKey="today-task-pool"
        defaultOpen
        className="v2-pool-card"
      >
        {pastDueCount > 0 && onOpenPastDue && (
          <button
            type="button"
            className="text-button v2-past-due-link"
            onClick={onOpenPastDue}
            aria-label={`${pastDueCount} past due. Open the Past due list in All work`}
          >
            Past due: {pastDueCount} · View
          </button>
        )}
        {candidates.length ? (
          <ul className="today-pool-list v2-pool-list">
            {candidates.map(task => (
              <li className="today-pool-item v2-pool-item" key={task.id}>
                <button
                  type="button"
                  className="today-pool-title v2-pool-task-title"
                  aria-label={`${choosingId === task.id ? "Close choice form for" : "Choose"} ${task.title} as Next thing`}
                  onClick={() => choosingId === task.id ? cancelChoice() : beginChoose(task)}
                >
                  {task.title}
                </button>
                {choosingId === task.id && !editingSelected && choiceForm(task.id)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted" role="status">No available tasks in the pool right now.</p>
        )}
      </V2FoldableCard>
    </div>
  );
}
