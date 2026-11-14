import WhyLine from "./WhyLine";
import ParentLists from "./ParentLists";
import { chainsForProject, describeWhy } from "../../domain/goals";
import { groupByStable } from "../../domain/accordionGroups";
import React from "react";
import { DecisionField, ImperativePicker, NotionField } from "./CompassFields";
import type { Imperative } from "../../domain/compass";
import { emptyProjectCompass } from "../../domain/compass";
import {
  confirmProjectImperatives,
  effectiveProjectRole,
  effectiveTaskRole,
  matrixBalance,
  minutesText,
  projectRowIsLinked,
  ROLE_LABEL,
  rowLabel,
} from "../../domain/linkCheck";
import { emptyProjectSchedule } from "../../domain/time";
import { downloadPrivate } from "../../lib/cloudApi";
import { useEffect, useMemo, useState } from "react";
import ProjectServes from "./ProjectServes";
import ProjectOutcomesMap from "./ProjectOutcomesMap";
import AccordionSection from "./AccordionSection";
import TimingShapeMark from "./TimingShapeMark";
import CardDotsMark from "./CardDotsMark";
import { whenChip } from "./WorkViews";
import { isFaded } from "../../domain/taskCard";
import { adelaideClock } from "../../domain/time";
import { ChevronLeft, Info, MoreVertical } from "lucide-react";
import {
  Check,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Pencil,
  Plus,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/dialog";
import {
  attention,
  deadlineLabel,
  derivedState,
  stateLabel,
  today,
} from "../../domain/engine";
import type {
  LifePattern,
  LifeRole,
  MatrixCell,
  Project,
  Task,
  Workspace,
} from "../../domain/types";

interface Props {
  view: "projects" | "matrix";
  workspace: Workspace;
  onMutate: (change: (w: Workspace) => Workspace) => boolean | void;
  onOpenTask: (t: Task) => void;
  onAddTask: (projectId: string) => void;
  onOpenGoal?: (id: string) => void;
  /** Scroll to and highlight this project once (opened from the map). */
  focusProjectId?: string | null;
  onFocusDone?: () => void;
  readOnly: boolean;
  /** Complete a task from its round Done circle. */
  onDoneTask?: (id: string) => boolean | void;
  /** Open a list on the Lists page. */
  onOpenList?: (templateId: string) => void;
}

/** Cells have no names: the plain description is all that is shown. */
const CELL_DETAILS: Record<
  MatrixCell,
  { description: string; axes: string; role: LifeRole; pattern: LifePattern }
> = {
  "direction-timely": {
    description: "A chosen thing with a window",
    axes: "Imperative and Timely",
    role: "direction",
    pattern: "timely",
  },
  "direction-sustained": {
    description: "A chosen thing that grows through regular engagement",
    axes: "Imperative and Sustained",
    role: "direction",
    pattern: "sustained",
  },
  "support-timely": {
    description: "Upkeep that falls due",
    axes: "Support and Timely",
    role: "support",
    pattern: "timely",
  },
  "support-sustained": {
    description: "Upkeep that recurs",
    axes: "Support and Sustained",
    role: "support",
    pattern: "sustained",
  },
};

function freshId(prefix: string): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

function localStamp(day = today()): string {
  return `${day}T12:00:00`;
}

function emptyProject(): Project {
  const stamp = localStamp();
  return {
    id: freshId("project"),
    title: "",
    purpose: "",
    outcome: "",
    role: "direction",
    pattern: "sustained",
    status: "active",
    milestones: [],
    progress: [],
    createdAt: stamp,
    updatedAt: stamp,
    schedule: emptyProjectSchedule(),
    compass: emptyProjectCompass(),
  };
}

function projectStatusLabel(project: Project): string {
  return project.status === "achieved"
    ? "Outcome explicitly marked achieved"
    : project.role === "support" && project.pattern === "sustained"
      ? "Ongoing support — no outcome is inferred from task counts"
      : "Active — outcome not yet marked achieved";
}

export default function LifeView({
  view,
  workspace,
  onMutate,
  onOpenTask,
  onAddTask,
  onOpenGoal,
  focusProjectId,
  onFocusDone,
  readOnly,
}: Props) {
  if (view === "matrix") {
    return (
      <MatrixView
        workspace={workspace}
        onMutate={onMutate}
        onOpenTask={onOpenTask}
        readOnly={readOnly}
      />
    );
  }

  return (
    <ProjectsView
      workspace={workspace}
      onMutate={onMutate}
      onOpenTask={onOpenTask}
      onAddTask={onAddTask}
      onOpenGoal={onOpenGoal}
      focusProjectId={focusProjectId}
      onFocusDone={onFocusDone}
      readOnly={readOnly}
    />
  );
}

function ProjectsView({
  workspace,
  onMutate,
  onOpenTask,
  onAddTask,
  onOpenGoal,
  focusProjectId,
  onFocusDone,
  readOnly,
  onDoneTask,
  onOpenList,
}: Omit<Props, "view">) {
  const [editing, setEditing] = useState<Project | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [info, setInfo] = useState(false);
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [projectView, setProjectView] = useState<"list" | "map">("list");
  const [projectSearch, setProjectSearch] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);
  useEffect(() => {
    if (!focusProjectId) return;
    setOpenId(focusProjectId);
    window.scrollTo({ top: 0 });
    setHighlight(focusProjectId);
    onFocusDone?.();
    const t = setTimeout(() => setHighlight(null), 2500);
    return () => clearTimeout(t);
    // Runs once per requested focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusProjectId]);
  const [creating, setCreating] = useState(false);
  const [projectError, setProjectError] = useState("");
  const [milestoneDrafts, setMilestoneDrafts] = useState<
    Record<string, string>
  >({});
  const [evidenceDrafts, setEvidenceDrafts] = useState<Record<string, string>>(
    {}
  );
  const projects = workspace.projects ?? [];
  const visibleProjects = useMemo(() => {
    const needle = projectSearch.trim().toLocaleLowerCase("en-AU");
    if (!needle) return projects;
    return projects.filter(project => {
      const chains = chainsForProject(workspace, project.id);
      const linkedTaskText = workspace.tasks
        .filter(task => task.projectId === project.id)
        .map(task => `${task.title} ${task.nextAction}`)
        .join(" ");
      const mapText = chains
        .flat()
        .map(step => step.goal.title)
        .join(" ");
      return `${project.title} ${project.purpose} ${project.outcome} ${linkedTaskText} ${mapText} ${project.progress.map(entry => entry.text).join(" ")}`
        .toLocaleLowerCase("en-AU")
        .includes(needle);
    });
  }, [projects, projectSearch, workspace]);
  const projectGroups = useMemo(
    () =>
      groupByStable(visibleProjects, project => {
        const pillarIds = [
          ...new Set(
            chainsForProject(workspace, project.id)
              .map(chain => chain.at(-1)?.goal)
              .filter(goal => goal?.level === "pillar")
              .map(goal => goal!.id)
          ),
        ].sort();
        const label = pillarIds.length
          ? pillarIds
              .map(
                id =>
                  (workspace.goals ?? []).find(goal => goal.id === id)?.title ??
                  "Pillar"
              )
              .join(" · ")
          : "Not linked";
        return { key: pillarIds.join("|") || "unlinked", label };
      }),
    [visibleProjects, workspace]
  );

  const updateProject = (
    projectId: string,
    change: (project: Project) => Project
  ) => {
    if (readOnly) return;
    onMutate(current => ({
      ...current,
      projects: (current.projects ?? []).map(project =>
        project.id === projectId
          ? { ...change(project), updatedAt: localStamp() }
          : project
      ),
    }));
  };

  const addMilestone = (projectId: string) => {
    const title = milestoneDrafts[projectId]?.trim();
    if (!title || readOnly) return;
    updateProject(projectId, project => ({
      ...project,
      milestones: [
        ...project.milestones,
        { id: freshId("milestone"), title, done: false },
      ],
    }));
    setMilestoneDrafts(current => ({ ...current, [projectId]: "" }));
  };

  const addEvidence = (projectId: string) => {
    const text = evidenceDrafts[projectId]?.trim();
    if (!text || readOnly) return;
    updateProject(projectId, project => ({
      ...project,
      progress: [...project.progress, { at: localStamp(), text }],
    }));
    setEvidenceDrafts(current => ({ ...current, [projectId]: "" }));
  };

  const saveProject = (project: Project, isNew: boolean) => {
    if (readOnly) return;
    const updated = {
      ...project,
      title: project.title.trim(),
      updatedAt: localStamp(),
    };
    let changedElsewhere = false;
    const accepted = onMutate(current => {
      if (
        !isNew &&
        JSON.stringify(current.projects.find(p => p.id === updated.id)) !==
          JSON.stringify(editing)
      ) {
        changedElsewhere = true;
        return current;
      }
      return {
        ...current,
        projects: isNew
          ? [...current.projects, updated]
          : current.projects.map(item =>
              item.id === updated.id ? updated : item
            ),
      };
    });
    if (changedElsewhere) {
      setProjectError(
        "This project changed while its draft was open. Download the draft before closing and reopening the updated project."
      );
      return false;
    }
    if (accepted === false) {
      setProjectError(
        "This project was not saved. The draft stays open; check sync/storage before retrying."
      );
      return false;
    }
    setProjectError("");
    setCreating(false);
    setEditing(null);
    return true;
  };

  const openTasksOf = (projectId: string) =>
    workspace.tasks.filter(task => task.projectId === projectId && task.state !== "done" && !task.droppedAt);
  const opened = openId ? projects.find(project => project.id === openId) ?? null : null;
  const activeGroups = projectGroups
    .map(group => ({ ...group, items: group.items.filter(project => project.status === "active") }))
    .filter(group => group.items.length);
  const achieved = visibleProjects.filter(project => project.status === "achieved");

  const projectRow = (project: Project) => (
    <button
      key={project.id}
      type="button"
      id={`project-${project.id}`}
      className={`tp-row pj-row${projectRowIsLinked(project, workspace) ? " tp-green" : ""}${highlight === project.id ? " is-focused" : ""}`}
      onClick={() => {
        setOpenId(project.id);
        setOutcomeOpen(false);
        window.scrollTo({ top: 0 });
      }}
    >
      <span className="pj-row-top">
        <span className="tp-title">{project.title}</span>
        {project.status === "active" && <span className="tp-meta">{openTasksOf(project.id).length} open</span>}
      </span>
      <TimingShapeMark project={project} noGreen />
    </button>
  );

  return (
    <>
      {opened ? (
        <ProjectPage
          project={opened}
          workspace={workspace}
          readOnly={readOnly}
          outcomeOpen={outcomeOpen}
          onToggleOutcome={() => setOutcomeOpen(v => !v)}
          onBack={() => setOpenId(null)}
          onEdit={() => setEditing(opened)}
          onOpenTask={onOpenTask}
          onAddTask={onAddTask}
          onDoneTask={onDoneTask}
          onOpenList={onOpenList}
          onOpenGoal={onOpenGoal}
          onMutate={onMutate}
          updateProject={updateProject}
          milestoneDraft={milestoneDrafts[opened.id] ?? ""}
          onMilestoneDraft={value => setMilestoneDrafts(current => ({ ...current, [opened.id]: value }))}
          onAddMilestone={() => addMilestone(opened.id)}
          evidenceDraft={evidenceDrafts[opened.id] ?? ""}
          onEvidenceDraft={value => setEvidenceDrafts(current => ({ ...current, [opened.id]: value }))}
          onAddEvidence={() => addEvidence(opened.id)}
        />
      ) : (
        <div className="pj">
          <div className="pj-toolbar">
            <div className="segmented life-project-view-switch" role="group" aria-label="Projects view">
              <button type="button" className={projectView === "list" ? "on" : ""} aria-pressed={projectView === "list"} onClick={() => setProjectView("list")}>
                List
              </button>
              <button type="button" className={projectView === "map" ? "on" : ""} aria-pressed={projectView === "map"} onClick={() => setProjectView("map")}>
                Map
              </button>
            </div>
            <span className="pj-spacer" />
            <button type="button" className="tp-btn" onClick={() => setCreating(true)} disabled={readOnly}>
              + Project
            </button>
            <button type="button" className="tp-info-button" aria-label="What this page shows" aria-expanded={info} onClick={() => setInfo(v => !v)}>
              <Info size={18} aria-hidden="true" />
            </button>
          </div>
          {info && (
            <p className="tp-info" role="note">
              Projects hold the outcome you chose, why it matters, and its next steps. Tap a project to open it. Completing tasks or milestones never marks an outcome achieved for you.
            </p>
          )}
          {projectView === "map" ? (
            <ProjectOutcomesMap
              workspace={workspace}
              onOpenProject={project => setOpenId(project.id)}
              onOpenGoal={onOpenGoal}
              readOnly={readOnly}
            />
          ) : (
            <>
              {projects.length > 5 && (
                <label className="library-search pj-search">
                  <input
                    type="search"
                    value={projectSearch}
                    onChange={event => setProjectSearch(event.target.value)}
                    placeholder="Search"
                    aria-label="Search projects"
                  />
                </label>
              )}
              {activeGroups.map((group, index) => (
                <AccordionSection
                  key={group.key}
                  persistenceKey={`pj-${group.key}`}
                  title={group.label}
                  count={group.items.length}
                  collapsible={visibleProjects.length > 5}
                  defaultOpen={index < 3}
                  revealToken={projectSearch && group.items.length ? projectSearch : ""}
                  className="pj-group"
                >
                  <div className="tp-list">{group.items.map(projectRow)}</div>
                </AccordionSection>
              ))}
              {achieved.length > 0 && (
                <AccordionSection
                  persistenceKey="pj-achieved"
                  title="Achieved"
                  count={achieved.length}
                  collapsible
                  defaultOpen={false}
                  className="pj-group"
                >
                  <div className="tp-list">{achieved.map(projectRow)}</div>
                </AccordionSection>
              )}
            </>
          )}
        </div>
      )}

      {(creating || editing) && (
        <ProjectDialog
          key={editing?.id ?? "new-project"}
          project={editing ?? emptyProject()}
          isNew={creating}
          readOnly={readOnly}
          imperatives={workspace.imperatives}
          why={creating ? "" : describeWhy(workspace, editing)}
          message={
            projectError ||
            (!creating &&
            JSON.stringify(projects.find(p => p.id === editing?.id)) !==
              JSON.stringify(editing)
              ? "The saved project changed while this draft was open. Your draft is kept here; download it before reopening the updated frame."
              : "")
          }
          onClose={() => {
            setProjectError("");
            setCreating(false);
            setEditing(null);
          }}
          onSave={saveProject}
        />
      )}
    </>
  );
}

/** A task row on a project page: the same compact row as Today and All work. */
function ProjectTaskRow({
  task,
  workspace,
  readOnly,
  onOpen,
  onDone,
}: {
  task: Task;
  workspace: Workspace;
  readOnly: boolean;
  onOpen: (t: Task) => void;
  onDone?: (id: string) => boolean | void;
}) {
  const done = task.state === "done";
  const state = derivedState(task, workspace.tasks);
  const when = done ? null : whenChip(task, adelaideClock().date);
  const faded = isFaded(task, workspace.tasks);
  return (
    <article className={`wr${effectiveTaskRole(task, workspace) === "direction" ? " wr-green" : ""}${faded ? " wr-faded" : ""}${done ? " wr-done" : ""}`}>
      <button
        type="button"
        className="wr-tick"
        aria-label={done ? `${task.title} is done` : `Mark ${task.title} done`}
        disabled={done || readOnly || !onDone}
        onClick={() => onDone?.(task.id)}
      >
        <span className="wr-circle">{done && <Check size={16} aria-hidden="true" />}</span>
      </button>
      <button type="button" className="wr-main" aria-label={`Open task ${task.title}`} onClick={() => onOpen(task)}>
        <span className="tp-title">{task.title}</span>
        {!done && (
          <span className="tp-signals">
            {when && <span className="tp-chip">{when}</span>}
            {(state === "blocked" || state === "waiting") && <span className="tp-chip">{state}</span>}
            <TimingShapeMark task={task} noGreen />
            {faded && <CardDotsMark task={task} tasks={workspace.tasks} />}
          </span>
        )}
      </button>
    </article>
  );
}

/** One project: Next step, Why, Outcome, Tasks; the rest folded. */
export function ProjectPage(p: {
  project: Project;
  workspace: Workspace;
  readOnly: boolean;
  outcomeOpen: boolean;
  onToggleOutcome: () => void;
  onBack: () => void;
  onEdit: () => void;
  onOpenTask: (t: Task) => void;
  onAddTask: (projectId: string) => void;
  onDoneTask?: (id: string) => boolean | void;
  /** Open a list on the Lists page. */
  onOpenList?: (templateId: string) => void;
  onOpenGoal?: (id: string) => void;
  onMutate: (change: (w: Workspace) => Workspace) => boolean | void;
  updateProject: (projectId: string, change: (project: Project) => Project) => void;
  milestoneDraft: string;
  onMilestoneDraft: (value: string) => void;
  onAddMilestone: () => void;
  evidenceDraft: string;
  onEvidenceDraft: (value: string) => void;
  onAddEvidence: () => void;
}) {
  const { project, workspace } = p;
  const linked = workspace.tasks.filter(task => task.projectId === project.id && !task.droppedAt);
  const open = linked.filter(task => task.state !== "done");
  const doneTasks = linked.filter(task => task.state === "done");
  const nextStep = project.status === "active" ? open.find(task => !task.parent?.suggested) : undefined;
  const rest = open.filter(task => task.id !== nextStep?.id);
  const milestonesDone = project.milestones.filter(m => m.done).length;
  return (
    <div className="pj pj-page">
      <div className="pj-page-head">
        <button type="button" className="tp-info-button" aria-label="Back to Projects" onClick={p.onBack}>
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <span className="pj-spacer" />
        <button type="button" className="tp-info-button" aria-label={`Edit project ${project.title}`} onClick={p.onEdit} disabled={p.readOnly}>
          <MoreVertical size={18} aria-hidden="true" />
        </button>
      </div>
      <div className={`pj-title${projectRowIsLinked(project, workspace) ? " pj-title--green" : ""}`}>
        <h2 className="tp-title">{project.title}</h2>
        <span className="tp-signals">
          <span className="tp-meta">{project.status === "achieved" ? "Achieved" : "Active"}</span>
          <TimingShapeMark project={project} noGreen />
        </span>
      </div>

      {project.status === "active" && (
        <>
          <h3 className="tp-label">Next step</h3>
          {nextStep ? (
            <ProjectTaskRow task={nextStep} workspace={workspace} readOnly={p.readOnly} onOpen={p.onOpenTask} onDone={p.onDoneTask} />
          ) : (
            <button type="button" className="tp-link pj-add" disabled={p.readOnly} onClick={() => p.onAddTask(project.id)}>
              + Add a step
            </button>
          )}
        </>
      )}

      <h3 className="tp-label">Why</h3>
      <ProjectServes workspace={workspace} project={project} onMutate={p.onMutate} onOpenGoal={p.onOpenGoal} readOnly={p.readOnly} />

      <h3 className="tp-label">Outcome</h3>
      {project.outcome.trim() ? (
        <button type="button" className={`pj-outcome${p.outcomeOpen ? " is-open" : ""}`} aria-expanded={p.outcomeOpen} onClick={p.onToggleOutcome}>
          {project.outcome}
        </button>
      ) : (
        <button type="button" className="tp-link pj-add" disabled={p.readOnly} onClick={p.onEdit}>
          + Add outcome
        </button>
      )}

      <h3 className="tp-label">Tasks{rest.length ? ` (${rest.length} more open)` : ""}</h3>
      <div className="pj-tasks">
        {rest.map(task => (
          <ProjectTaskRow key={task.id} task={task} workspace={workspace} readOnly={p.readOnly} onOpen={p.onOpenTask} onDone={p.onDoneTask} />
        ))}
        {(nextStep || project.status === "achieved") && (
          <button type="button" className="tp-link pj-add" disabled={p.readOnly} onClick={() => p.onAddTask(project.id)}>
            + Add a step
          </button>
        )}
        {doneTasks.length > 0 && (
          <details className="pj-fold">
            <summary>Done ({doneTasks.length})</summary>
            {doneTasks.map(task => (
              <ProjectTaskRow key={task.id} task={task} workspace={workspace} readOnly={p.readOnly} onOpen={p.onOpenTask} />
            ))}
          </details>
        )}
      </div>

      {p.onOpenList && (
        <ParentLists
          workspace={workspace}
          target={{ kind: "project", id: project.id }}
          readOnly={p.readOnly}
          onMutate={p.onMutate}
          onOpenList={p.onOpenList}
        />
      )}

      <details className="pj-fold">
        <summary>
          Milestones {project.milestones.length ? `${milestonesDone}/${project.milestones.length}` : ""}
        </summary>
        {project.milestones.map(milestone => (
          <label className="life-milestone" key={milestone.id}>
            <input
              type="checkbox"
              checked={milestone.done}
              disabled={p.readOnly}
              aria-label={`Mark milestone ${milestone.title} ${milestone.done ? "incomplete" : "complete"}`}
              onChange={event =>
                p.updateProject(project.id, current => ({
                  ...current,
                  milestones: current.milestones.map(item =>
                    item.id === milestone.id ? { ...item, done: event.target.checked } : item
                  ),
                }))
              }
            />
            <span>{milestone.title}</span>
            <input
              type="date"
              className="milestone-date"
              aria-label={`Date for milestone ${milestone.title}`}
              disabled={p.readOnly}
              value={project.schedule.milestoneDates.find(item => item.id === milestone.id)?.date ?? ""}
              onChange={event => {
                const date = event.target.value;
                p.updateProject(project.id, current => ({
                  ...current,
                  schedule: {
                    ...current.schedule,
                    milestoneDates: [
                      ...current.schedule.milestoneDates.filter(item => item.id !== milestone.id),
                      ...(date ? [{ id: milestone.id, date }] : []),
                    ],
                  },
                }));
              }}
            />
          </label>
        ))}
        <div className="inline-field life-inline-add">
          <input
            aria-label={`New milestone for ${project.title}`}
            value={p.milestoneDraft}
            maxLength={240}
            placeholder="+ Add a milestone"
            disabled={p.readOnly}
            onChange={event => p.onMilestoneDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter") {
                event.preventDefault();
                p.onAddMilestone();
              }
            }}
          />
          <button className="tp-btn" type="button" disabled={p.readOnly || !p.milestoneDraft.trim()} onClick={p.onAddMilestone}>
            Add
          </button>
        </div>
      </details>

      <details className="pj-fold">
        <summary>Observed evidence {project.progress.length ? `(${project.progress.length})` : ""}</summary>
        {[...project.progress].reverse().map((entry, index) => (
          <p className="history" key={`${entry.at}-${index}`}>
            <time>{entry.at.slice(0, 10)}</time>
            {entry.text}
          </p>
        ))}
        <div className="inline-field life-inline-add">
          <input
            aria-label={`Observed evidence for ${project.title}`}
            value={p.evidenceDraft}
            maxLength={1000}
            placeholder="+ Add what you observed"
            disabled={p.readOnly}
            onChange={event => p.onEvidenceDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter") {
                event.preventDefault();
                p.onAddEvidence();
              }
            }}
          />
          <button className="tp-btn" type="button" disabled={p.readOnly || !p.evidenceDraft.trim()} onClick={p.onAddEvidence}>
            Save
          </button>
        </div>
      </details>

      <details className="pj-fold">
        <summary>Purpose</summary>
        {project.purpose.trim() ? (
          <p className="pj-purpose">{project.purpose}</p>
        ) : (
          <button type="button" className="tp-link pj-add" disabled={p.readOnly} onClick={p.onEdit}>
            + Add purpose
          </button>
        )}
      </details>

      <button
        type="button"
        className="tp-btn pj-achieve"
        disabled={p.readOnly}
        onClick={() =>
          p.updateProject(project.id, current => ({
            ...current,
            status: current.status === "achieved" ? "active" : "achieved",
          }))
        }
      >
        {project.status === "achieved" ? "Reopen outcome" : "Mark outcome achieved"}
      </button>
    </div>
  );
}

interface ProjectDialogProps {
  project: Project;
  isNew: boolean;
  readOnly: boolean;
  onClose: () => void;
  onSave: (project: Project, isNew: boolean) => boolean | void;
  message?: string;
  imperatives: Imperative[];
  why?: string;
}

function ProjectDialog({
  project,
  isNew,
  readOnly,
  onClose,
  onSave,
  message = "",
  imperatives,
  why = "",
}: ProjectDialogProps) {
  const [draft, setDraft] = useState<Project>(() => structuredClone(project));
  const [error, setError] = useState("");
  const patch = <K extends keyof Project>(key: K, value: Project[K]) =>
    setDraft(current => ({ ...current, [key]: value }));

  const submit = () => {
    if (!draft.title.trim()) {
      setError("Give this project a clear name.");
      return;
    }
    onSave({ ...draft, title: draft.title.trim() }, isNew);
  };

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="task-dialog life-project-dialog">
        <div className="eyebrow">MY LIFE · PROJECT</div>
        {message && (
          <div className="notice" role="alert">
            <p>{message}</p>
            <p className="small">
              This draft download is not a full workspace backup.
            </p>
            <button
              className="button secondary"
              onClick={() =>
                downloadPrivate(
                  JSON.stringify(draft, null, 2),
                  "steadier-project-draft.json"
                )
              }
            >
              Download this project draft
            </button>
          </div>
        )}
        <DialogTitle className="dialog-heading">
          {isNew ? "Name a direction to hold." : "Clarify the project frame."}
        </DialogTitle>
        <DialogDescription>
          These fields hold the choice you made. They do not make the choice for
          you.
        </DialogDescription>
        <form
          onSubmit={event => {
            event.preventDefault();
            submit();
          }}
        >
          <label className="field">
            Project name
            <input
              aria-label="Project name"
              value={draft.title}
              maxLength={240}
              disabled={readOnly}
              onChange={event => patch("title", event.target.value)}
            />
          </label>
          <label className="field">
            Purpose
            <textarea
              aria-label="Project purpose"
              value={draft.purpose}
              rows={3}
              maxLength={2000}
              disabled={readOnly}
              placeholder="Why hold this project?"
              onChange={event => patch("purpose", event.target.value)}
            />
          </label>
          <label className="field">
            Outcome
            <textarea
              aria-label="Project outcome"
              value={draft.outcome}
              rows={3}
              maxLength={2000}
              disabled={readOnly}
              placeholder="What would you explicitly be able to mark achieved?"
              onChange={event => patch("outcome", event.target.value)}
            />
          </label>
          <div className="form-pair">
            <label className="field">
              Role
              {projectRowIsLinked(draft, { imperatives }) ? (
                <span className="derived-row" aria-label="Project role">
                  Imperative (linked)
                  <span className="small muted">
                    {" "}
                    The Imperative link decides the row. Your own choice (
                    {ROLE_LABEL[draft.role]}) comes back if the link ends.
                  </span>
                </span>
              ) : (
                <select
                  aria-label="Project role"
                  value={draft.role}
                  disabled={readOnly}
                  onChange={event =>
                    patch("role", event.target.value as LifeRole)
                  }
                >
                  <option value="direction">Imperative</option>
                  <option value="support">Support</option>
                </select>
              )}
            </label>
            <label className="field">
              Pattern
              <select
                aria-label="Project pattern"
                value={draft.pattern}
                disabled={readOnly}
                onChange={event =>
                  patch("pattern", event.target.value as LifePattern)
                }
              >
                <option value="timely">Timely</option>
                <option value="sustained">Sustained</option>
              </select>
            </label>
          </div>
          <div className="schedule-grid">
            <label className="field">
              Project deadline
              <input
                type="date"
                aria-label="Project deadline"
                value={draft.schedule.deadline ?? ""}
                disabled={readOnly}
                onChange={event =>
                  patch("schedule", {
                    ...draft.schedule,
                    deadline: event.target.value || null,
                  })
                }
              />
            </label>
            <label className="field">
              Next review
              <input
                type="date"
                aria-label="Project review date"
                value={draft.schedule.reviewDate ?? ""}
                disabled={readOnly}
                onChange={event =>
                  patch("schedule", {
                    ...draft.schedule,
                    reviewDate: event.target.value || null,
                  })
                }
              />
            </label>
            <label className="field">
              Time per week (min)
              <input
                type="number"
                min={5}
                step={15}
                aria-label="Weekly time budget in minutes"
                placeholder="e.g. 120"
                value={draft.schedule.weeklyBudgetMinutes ?? ""}
                disabled={readOnly}
                onChange={event =>
                  patch("schedule", {
                    ...draft.schedule,
                    weeklyBudgetMinutes: event.target.value
                      ? Math.max(5, Math.min(10080, Number(event.target.value)))
                      : null,
                  })
                }
              />
            </label>
          </div>
          <fieldset className="compass-fieldset" disabled={readOnly}>
            <legend>Compass</legend>
            {!draft.compass.labelsConfirmed && (
              <p className="suggestion-line small">
                <span className="suggested-chip">Suggested</span> Role and
                pattern above are not decided until you confirm them.
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    patch("compass", {
                      ...draft.compass,
                      labelsConfirmed: true,
                    })
                  }
                >
                  Confirm role and pattern
                </button>
              </p>
            )}
            {why && <WhyLine text={why} />}
            <div className="field">
              <span>Serves Imperative</span>
              {draft.compass.imperativesSuggested &&
                draft.compass.imperativeIds.length > 0 && (
                  <p className="suggestion-line small">
                    <span className="suggested-chip">Suggested</span> These
                    links are not yours until you confirm them.
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        setDraft(current =>
                          confirmProjectImperatives(current, current.updatedAt)
                        )
                      }
                    >
                      Confirm links
                    </button>
                  </p>
                )}
              <ImperativePicker
                selected={draft.compass.imperativeIds}
                imperatives={imperatives}
                onChange={imperativeIds => {
                  // Picking here is the owner's own choice.
                  const { imperativesSuggested: _s, ...compass } =
                    draft.compass;
                  patch("compass", { ...compass, imperativeIds });
                }}
              />
            </div>
            <DecisionField
              decision={draft.compass.decision}
              onChange={decision =>
                patch("compass", { ...draft.compass, decision })
              }
            />
            <NotionField
              value={draft.compass.notionUrl}
              onChange={notionUrl => {
                setError("");
                patch("compass", { ...draft.compass, notionUrl });
              }}
              onError={setError}
            />
          </fieldset>
          <p className="small muted">
            A weekly time budget suits sustained work (e.g. 2 hours a week on
            health). Steadier shows how much of it you have given this week,
            gently, never as a score.
          </p>
          <label className="field">
            Outcome status
            <select
              aria-label="Project outcome status"
              value={draft.status}
              disabled={readOnly}
              onChange={event =>
                patch("status", event.target.value as Project["status"])
              }
            >
              <option value="active">Active</option>
              <option value="achieved">Achieved (explicit choice)</option>
            </select>
          </label>
          <p className="small muted">
            Support that is sustained can remain active indefinitely. Task and
            milestone counts do not change this status.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button primary"
              disabled={readOnly}
            >
              {isNew ? "Create project" : "Save project"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MatrixView({
  workspace,
  onOpenTask,
}: Pick<Props, "workspace" | "onMutate" | "onOpenTask" | "readOnly">) {
  const day = today();
  const commitments = useMemo(
    () => attention(workspace.tasks).commitments,
    [workspace.tasks]
  );
  const balance = useMemo(
    () => matrixBalance(workspace, day),
    [workspace, day]
  );
  const unclassified = balance.unclassified;

  return (
    <>
      <div className="page-heading life-heading">
        <div className="eyebrow">MY LIFE · BALANCED VIEW</div>
        <h1>See the parts that could disappear from view.</h1>
        <p className="life-matrix-reminder">
          <strong>Balance, not ranking.</strong>
        </p>
        <p>
          Rows: Imperative and Support. Columns: Timely and Sustained. Work
          linked to an active Imperative sits in the Imperative row; anything
          else stays where you put it.
        </p>
      </div>

      <div className="life-matrix-grid">
        {(Object.keys(CELL_DETAILS) as MatrixCell[]).map(cell => {
          const detail = CELL_DETAILS[cell];
          const { tasks, estimateMinutes, loggedMinutes } =
            balance.cells[cell];
          return (
            <section
              className="settings-section life-matrix-cell"
              key={cell}
              aria-label={`${detail.axes}: ${detail.description}`}
            >
              <div className="section-heading">
                <div>
                  <div className="eyebrow">
                    {tasks.length} OPEN · {minutesText(estimateMinutes)}{" "}
                    ESTIMATED · {minutesText(loggedMinutes)} LOGGED THIS WEEK
                  </div>
                  <h2>{detail.description}</h2>
                </div>
              </div>
              {tasks.length ? (
                <div className="life-matrix-task-list">
                  {tasks.slice(0, 8).map(task => (
                    <button
                      className="work-row-main life-matrix-task"
                      key={task.id}
                      onClick={() => onOpenTask(task)}
                    >
                      <strong>
                        <TimingShapeMark task={task} /> {task.title}
                      </strong>
                      <span>{rowLabel(task, workspace)}</span>
                    </button>
                  ))}
                  {tasks.length > 8 && (
                    <p className="small muted">
                      {tasks.length - 8} more held in this cell.
                    </p>
                  )}
                </div>
              ) : (
                <p className="small muted">Nothing in this cell yet.</p>
              )}
            </section>
          );
        })}
      </div>

      <section className="settings-section life-matrix-note">
        <div className="section-heading">
          <div>
            <div className="eyebrow">COMPASS STAYS WITH YOU</div>
            <h2>The matrix describes; it never orders.</h2>
          </div>
          <ClipboardCheck size={20} aria-hidden="true" />
        </div>
        <p>
          Counts and time show where your attention is going. Nothing here
          changes what Steadier suggests, how readiness works, or which real
          commitments you see. Life Admin and Erosion Guard stay places tasks
          live, not cells.
        </p>
      </section>

      <section className="settings-section life-unclassified-queue">
        <div className="section-heading">
          <div>
            <div className="eyebrow">UNCLASSIFIED QUEUE</div>
            <h2>Leave unclear work unlabelled.</h2>
          </div>
          <span className="small muted">{unclassified.length} tasks</span>
        </div>
        <p>
          Quick capture does not need an identity. Label a task only if the
          framing is useful; uncertainty is not an error to fix.
        </p>
        {unclassified.length ? (
          <div className="life-unclassified-list">
            {unclassified.slice(0, 12).map(task => (
              <button
                className="work-row-main life-matrix-task"
                key={task.id}
                onClick={() => onOpenTask(task)}
              >
                <strong>
                  <TimingShapeMark task={task} /> {task.title}
                </strong>
                <span>
                  {task.nextAction || "Choose a small next step when useful."}
                </span>
              </button>
            ))}
            {unclassified.length > 12 && (
              <p className="small muted">
                {unclassified.length - 12} more unclassified tasks are still
                held.
              </p>
            )}
          </div>
        ) : (
          <p className="small muted">
            No active tasks are unclassified right now. That is a view of what
            is written down, not a judgment about balance.
          </p>
        )}
      </section>

      <section className="settings-section life-commitment-summary">
        <div className="section-heading">
          <div>
            <div className="eyebrow">MUST-NOT-MISS COMMITMENTS</div>
            <h2>Dates keep their own place.</h2>
          </div>
          <Check size={20} aria-hidden="true" />
        </div>
        <p>
          This independent list is not changed by the matrix. It is a
          reminder of real commitments, not a substitute for choosing with
          Compass.
        </p>
        {commitments.length ? (
          <div className="life-commitment-list">
            {commitments.map(task => (
              <button
                className="work-row-main life-matrix-task"
                key={task.id}
                onClick={() => onOpenTask(task)}
              >
                <strong>
                  <TimingShapeMark task={task} /> {task.title}
                </strong>
                <span>{deadlineLabel(task)}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="small muted">
            No approaching or passed real-date commitments are in this list.
          </p>
        )}
      </section>

      <p className="footnote life-matrix-footnote">
        <ChevronRight size={15} /> The matrix can make a blind spot visible.
        Only Compass decides what belongs in your day.
      </p>
    </>
  );
}
