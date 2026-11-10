import React, { useMemo, useState, type ReactNode } from "react";
import { ArrowRight, CheckCheck, Layers3 } from "lucide-react";
import { KIND_LABEL } from "../../domain/todayStates";
import { buildWorkPipeline } from "../../domain/workPipeline";
import AccordionSection from "./AccordionSection";
import TimingShapeMark from "./TimingShapeMark";
import type { KindContext } from "../../domain/todayStates";
import type { Task, Workspace } from "../../domain/types";
import { adelaideClock } from "../../domain/time";

interface Props {
  workspace: Workspace;
  kinds: KindContext;
  onOpenTask: (task: Task) => void;
  onDone: (taskId: string) => void;
  onOpenProject: (projectId: string) => void;
}

interface PipelineTaskRowProps {
  task: Task;
  className?: string;
  secondary?: string;
  status: ReactNode;
  onOpen: () => void;
  onDone: (taskId: string) => void;
}

export function WorkPipelineTaskRow({
  task,
  className = "",
  secondary,
  status,
  onOpen,
  onDone,
}: PipelineTaskRowProps) {
  const completed = task.state === "done";
  return (
    <div className={`pipeline-task-row${className ? ` ${className}` : ""}`}>
      <label className="pipeline-task-done-tick">
        <input
          type="checkbox"
          checked={completed}
          disabled={completed}
          aria-label={
            completed ? `${task.title} is done` : `Mark ${task.title} done`
          }
          onChange={() => onDone(task.id)}
        />
        <span>Done</span>
      </label>
      <button
        className="pipeline-task-open"
        type="button"
        onClick={onOpen}
        aria-label={`Open ${task.title}`}
      >
        <span className="pipeline-task-copy">
          <strong>
            <TimingShapeMark task={task} /> {task.title}
          </strong>
          {secondary && <span className="small muted">{secondary}</span>}
        </span>
      </button>
      <span className="pipeline-task-status">{status}</span>
    </div>
  );
}

function dateLabel(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export default function WorkPipelineView({
  workspace,
  kinds,
  onOpenTask,
  onDone,
  onOpenProject,
}: Props) {
  const [query, setQuery] = useState("");
  const rows = useMemo(
    () => buildWorkPipeline(workspace, kinds),
    [workspace, kinds]
  );
  const visibleRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-AU");
    if (!needle) return rows;
    return rows.filter(row =>
      [
        row.project.title,
        row.project.purpose,
        row.project.outcome,
        row.latestProgress?.text ?? "",
        ...row.tasks.flatMap(entry => [
          entry.task.title,
          entry.task.nextAction,
        ]),
        ...row.suggestedTasks.flatMap(task => [task.title, task.nextAction]),
      ]
        .join(" ")
        .toLocaleLowerCase("en-AU")
        .includes(needle)
    );
  }, [rows, query]);
  const visibleItemCount = visibleRows.reduce(
    (count, row) => count + 1 + row.tasks.length + row.suggestedTasks.length,
    0
  );
  const today = adelaideClock().date;
  return (
    <main className="work-pipeline-view page-view">
      <header className="page-heading">
        <div>
          <div className="eyebrow">PROJECTS · CURRENT WORK</div>
          <h1>Work Pipeline</h1>
          <p>
            A project-linked view of saved work. Use the square Done tick to
            complete a task, or tap its title to open details. A Task appears
            inside a Project only when its Project link is confirmed; suggested
            links stay separate until you confirm them.
          </p>
        </div>
      </header>
      {rows.length > 0 && (
        <label className="field accordion-search">
          <span>Search projects and linked work</span>
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Project, task or next action"
          />
        </label>
      )}
      {visibleRows.length === 0 ? (
        <div className="empty-state">
          <Layers3 size={24} aria-hidden />
          <h2>
            {rows.length ? "No projects match this search" : "No Projects yet"}
          </h2>
          <p>
            {rows.length
              ? "Try a project, task, next action or outcome."
              : "Create a Project in Project Outcomes and it will appear here."}
          </p>
        </div>
      ) : (
        <>
          <div className="accordion-group-list pipeline-project-list">
            {visibleRows.map((row, index) => {
            const { project } = row;
            const deadline = dateLabel(project.schedule.deadline);
            const doneSteps = row.tasks.filter(
              entry => entry.task.state === "done"
              );
              const openForUrgency =
                Boolean(project.schedule.deadline && project.schedule.deadline <= today) ||
                row.tasks.some(
                  entry =>
                    entry.task.state !== "done" &&
                    [
                      entry.task.deadline,
                      entry.task.schedule.date,
                      entry.task.reviewDate,
                    ].some(date => Boolean(date && date <= today))
                ) ||
                row.suggestedTasks.some(task =>
                  [task.deadline, task.schedule.date, task.reviewDate].some(
                    date => Boolean(date && date <= today)
                  )
                );
              return (
                <AccordionSection
                  className="pipeline-project-accordion"
                  key={project.id}
                  persistenceKey={project.id}
                  title={project.title}
                  count={1 + row.tasks.length + row.suggestedTasks.length}
                  collapsible={visibleItemCount > 5}
                  defaultOpen={index === 0 || openForUrgency}
                  autoOpen={openForUrgency}
                  revealToken={query && visibleRows.length ? query : ""}
                >
                  <article className="pipeline-project">
                <header className="pipeline-project-heading">
                  <div>
                    <div className="pipeline-project-meta">
                      <span className={`status-pill ${project.status}`}>
                            {project.status === "achieved"
                              ? "Achieved"
                              : "Active"}
                      </span>
                      {deadline && (
                        <span className="small">Due {deadline}</span>
                      )}
                      {row.milestoneProgress.total > 0 && (
                        <span className="small">
                          Milestones {row.milestoneProgress.done}/
                          {row.milestoneProgress.total}
                        </span>
                      )}
                    </div>
                    <h2>
                      <TimingShapeMark project={project} /> {project.title}
                    </h2>
                    <p className="small muted">{project.outcome}</p>
                  </div>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => onOpenProject(project.id)}
                  >
                    Open Project <ArrowRight size={15} aria-hidden />
                  </button>
                </header>
                {row.tasks.filter(entry => entry.task.state !== "done")
                  .length ? (
                  <div
                    className="pipeline-task-list"
                    aria-label="Linked open tasks"
                  >
                    {row.tasks
                      .filter(entry => entry.task.state !== "done")
                      .map(({ task, kind, heldReason }) => (
                        <WorkPipelineTaskRow
                          key={task.id}
                          task={task}
                          secondary={task.nextAction}
                          status={
                            <>
                              <span className={`task-kind ${kind ?? "held"}`}>
                                {kind ? KIND_LABEL[kind] : "Held"}
                              </span>
                              {kind === "held" && heldReason && (
                                <span className="small muted">
                                  {heldReason}
                                </span>
                              )}
                            </>
                          }
                          onOpen={() => onOpenTask(task)}
                          onDone={onDone}
                        />
                      ))}
                  </div>
                ) : (
                  <p className="small muted pipeline-no-open">
                    No linked open Tasks. Nothing is inferred from other
                    Projects or unlinked work.
                  </p>
                )}
                <div className="pipeline-summary">
                  <span>{row.counts.active} active</span>
                  <span>{row.counts.suggested} suggested</span>
                  <span>{row.counts.held} held</span>
                  <span className="pipeline-completed-count">
                        <CheckCheck size={14} aria-hidden />{" "}
                        {row.completedCount} completed
                  </span>
                </div>
                {row.suggestedTasks.length > 0 && (
                  <details className="pipeline-suggested">
                    <summary>
                      Suggested Project links · {row.suggestedTasks.length}
                    </summary>
                    <p className="small muted">
                          These Tasks are not counted as Project work until
                          their suggested link is confirmed in the Task.
                    </p>
                    {row.suggestedTasks.map(task => (
                      <WorkPipelineTaskRow
                        className="suggested"
                        key={task.id}
                        task={task}
                        status={<span className="small muted">Review link</span>}
                        onOpen={() => onOpenTask(task)}
                        onDone={onDone}
                      />
                    ))}
                  </details>
                )}
                {row.latestProgress && (
                  <details className="pipeline-latest-progress">
                    <summary>Latest recorded progress</summary>
                    <p className="small">
                      {row.latestProgress.at.slice(0, 10)} ·{" "}
                      {row.latestProgress.text}
                    </p>
                  </details>
                )}
                {doneSteps.length > 0 && (
                  <details className="pipeline-done-steps">
                    <summary>
                      Completed linked Tasks · {doneSteps.length}
                    </summary>
                    {doneSteps.map(({ task }) => (
                      <WorkPipelineTaskRow
                        className="completed"
                        key={task.id}
                        task={task}
                        status={<span className="small muted">Completed</span>}
                        onOpen={() => onOpenTask(task)}
                        onDone={onDone}
                      />
                    ))}
                  </details>
                )}
              </article>
                </AccordionSection>
            );
          })}
        </div>
        </>
      )}
    </main>
  );
}
