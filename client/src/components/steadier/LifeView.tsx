import WhyLine from "./WhyLine";
import { chainsForProject, describeWhy } from "../../domain/goals";
import { groupByStable } from "../../domain/accordionGroups";
import React from "react";
import { DecisionField, ImperativePicker, NotionField } from "./CompassFields";
import type { Imperative } from "../../domain/compass";
import { emptyProjectCompass } from "../../domain/compass";
import { emptyProjectSchedule } from "../../domain/time";
import { downloadPrivate } from "../../lib/cloudApi";
import { useEffect, useMemo, useState } from "react";
import ProjectServes from "./ProjectServes";
import ProjectOutcomesMap from "./ProjectOutcomesMap";
import AccordionSection from "./AccordionSection";
import TimingShapeMark from "./TimingShapeMark";
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
import {
  DEFAULT_MATRIX_WEIGHTS,
  identityLabel,
  matrixKey,
} from "../../domain/life";
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
}

const CELL_DETAILS: Record<
  MatrixCell,
  { title: string; description: string; role: LifeRole; pattern: LifePattern }
> = {
  "direction-timely": {
    title: "Direction · Timely",
    description: "Chosen direction with a real date attached.",
    role: "direction",
    pattern: "timely",
  },
  "direction-sustained": {
    title: "Direction · Sustained",
    description: "Chosen direction that benefits from steady return.",
    role: "direction",
    pattern: "sustained",
  },
  "support-timely": {
    title: "Support · Timely",
    description: "Care or upkeep with a real date attached.",
    role: "support",
    pattern: "timely",
  },
  "support-sustained": {
    title: "Support · Sustained",
    description: "Care or upkeep that remains ongoing.",
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
}: Omit<Props, "view">) {
  const [editing, setEditing] = useState<Project | null>(null);
  const [projectView, setProjectView] = useState<"list" | "map">("list");
  const [projectSearch, setProjectSearch] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);
  useEffect(() => {
    if (!focusProjectId) return;
    const el = document.getElementById(`project-${focusProjectId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
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
          : "Not yet linked to a Pillar";
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

  return (
    <>
      <div className="page-heading life-heading">
        <div className="eyebrow">MY LIFE · PROJECT OUTCOMES</div>
        <h1>Keep the direction you chose in view.</h1>
        <p>
          Projects hold purpose, outcomes, observed evidence, and small next
          tasks. Completing tasks or milestones never marks an outcome achieved
          for you.
        </p>
      </div>

      <div className="life-project-toolbar">
        <div className="life-project-toolbar-leading">
          <p className="small muted">
            Compass makes the choices. This is the place that remembers them.
          </p>
          <div
            className="segmented life-project-view-switch"
            role="group"
            aria-label="Project Outcomes view"
          >
            <button
              type="button"
              className={projectView === "list" ? "on" : ""}
              aria-pressed={projectView === "list"}
              onClick={() => setProjectView("list")}
            >
              List
            </button>
            <button
              type="button"
              className={projectView === "map" ? "on" : ""}
              aria-pressed={projectView === "map"}
              onClick={() => setProjectView("map")}
            >
              Map
            </button>
          </div>
        </div>
        <button
          className="button primary"
          onClick={() => setCreating(true)}
          disabled={readOnly}
        >
          <Plus size={16} />
          Add project
        </button>
      </div>

      {!projects.length && projectView === "list" && (
        <section className="empty-state life-empty-guidance">
          <CircleDot size={30} />
          <h2>Start with one outcome that matters.</h2>
          <p>
            A project can hold the purpose, the outcome you want to see, and a
            few linked next tasks. It does not need to describe everything.
          </p>
          <button
            className="button secondary"
            onClick={() => setCreating(true)}
            disabled={readOnly}
          >
            <Plus size={16} />
            Create a project
          </button>
        </section>
      )}

      {projectView === "map" ? (
        <ProjectOutcomesMap
          workspace={workspace}
          onOpenProject={setEditing}
          onOpenGoal={onOpenGoal}
          readOnly={readOnly}
        />
      ) : (
        <>
          {projects.length > 0 && (
            <label className="field accordion-search life-project-search">
              <span>Search projects and linked outcomes</span>
              <input
                type="search"
                value={projectSearch}
                onChange={event => setProjectSearch(event.target.value)}
                placeholder="Project, purpose, outcome or task"
              />
            </label>
          )}
          {visibleProjects.length === 0 && projects.length > 0 ? (
            <div className="empty-state life-empty-guidance">
              <CircleDot size={28} />
              <h2>No projects match this search.</h2>
              <p>Try a project name, purpose, outcome or linked task.</p>
            </div>
          ) : (
            <div className="accordion-group-list life-project-list">
              {projectGroups.map((group, index) => (
            <AccordionSection
              key={group.key}
              persistenceKey={group.key}
              title={group.label}
                  count={group.items.length}
              collapsible={visibleProjects.length > 5}
                  defaultOpen={
                    index === 0 ||
                    group.items.some(
                      project =>
                        project.id === focusProjectId ||
                        Boolean(
                          project.schedule.deadline &&
                            project.schedule.deadline <= today()
                        )
                    )
                  }
                  autoOpen={group.items.some(
                    project =>
                      Boolean(
                        project.schedule.deadline &&
                          project.schedule.deadline <= today()
                      )
                  )}
                  revealToken={
                    projectSearch && group.items.length ? projectSearch : ""
                  }
                  className="life-pillar-project-group"
                >
                  <div className="life-project-group-list">
                    {group.items.map(project => {
            const linkedTasks = workspace.tasks.filter(
              task => task.projectId === project.id
            );
            const nextStep = project.status === "active"
              ? linkedTasks.find(
                  task => task.state !== "done" && !task.parent?.suggested
                )
              : undefined;
            const nextStepState = nextStep
              ? derivedState(nextStep, workspace.tasks)
              : null;
            const milestoneDraft = milestoneDrafts[project.id] ?? "";
            const evidenceDraft = evidenceDrafts[project.id] ?? "";
            return (
              <section
                className={`settings-section life-project-card${highlight === project.id ? " is-focused" : ""}`}
                key={project.id}
                id={`project-${project.id}`}
              >
                <div className="section-heading life-project-card-heading">
                  <div>
                    <div className="eyebrow">
                      {project.role} · {project.pattern}
                    </div>
                    <h2>
                      <TimingShapeMark project={project} /> {project.title}
                    </h2>
                  </div>
                  <button
                    className="icon-button"
                    aria-label={`Edit project ${project.title}`}
                    onClick={() => setEditing(project)}
                    disabled={readOnly}
                  >
                    <Pencil size={16} />
                  </button>
                </div>

                <div className="life-project-status">
                  <span
                    className={`state-tag ${project.status === "achieved" ? "state-done" : ""}`}
                  >
                              {project.status === "achieved"
                                ? "Achieved"
                                : "Active"}
                  </span>
                  <span className="small muted">
                    {projectStatusLabel(project)}
                  </span>
                  <button
                    className="text-button"
                    disabled={readOnly}
                    onClick={() =>
                      updateProject(project.id, current => ({
                        ...current,
                        status:
                                    current.status === "achieved"
                                      ? "active"
                                      : "achieved",
                      }))
                    }
                  >
                    {project.status === "achieved"
                      ? "Reopen outcome"
                      : "Mark outcome achieved"}
                  </button>
                </div>

                <div className="life-project-next-step" aria-label={`Next step for ${project.title}`}>
                  <div className="life-project-next-step-copy">
                    <span className="eyebrow">NEXT STEP</span>
                    {nextStep ? (
                      <>
                        <strong>{nextStep.title}</strong>
                        <span>{nextStep.nextAction || "No next action yet."}</span>
                        <span className={`state-tag state-${nextStepState}`}>
                          {stateLabel(nextStepState!)}
                        </span>
                      </>
                    ) : (
                      <span className="small muted">
                        {project.status === "achieved"
                          ? "This outcome is marked achieved."
                          : "No active linked task yet. Add one small step if this outcome needs work."}
                      </span>
                    )}
                  </div>
                  {nextStep ? (
                    <button
                      type="button"
                      className="button secondary life-project-next-button"
                      aria-label={`Open next linked task ${nextStep.title}`}
                      onClick={() => onOpenTask(nextStep)}
                    >
                      Open next task
                    </button>
                  ) : project.status === "active" ? (
                    <button
                      type="button"
                      className="button secondary life-project-next-button"
                      aria-label={`Add small task to ${project.title}`}
                      disabled={readOnly}
                      onClick={() => onAddTask(project.id)}
                    >
                      <Plus size={15} aria-hidden="true" /> Add small task
                    </button>
                  ) : null}
                </div>

                <div className="life-project-description">
                  <div>
                    <strong>Purpose</strong>
                              <p>
                                {project.purpose || "No purpose written yet."}
                              </p>
                  </div>
                  <div>
                    <strong>Outcome</strong>
                              <p>
                                {project.outcome || "No outcome written yet."}
                              </p>
                  </div>
                </div>

                <ProjectServes
                  workspace={workspace}
                  project={project}
                  onMutate={onMutate}
                  onOpenGoal={onOpenGoal}
                  readOnly={readOnly}
                />
                <div className="life-project-section">
                  <div className="section-heading">
                    <div>
                      <div className="eyebrow">MILESTONES</div>
                      <h2>Explicitly complete</h2>
                    </div>
                    <span className="small muted">
                                {
                                  project.milestones.filter(item => item.done)
                                    .length
                                }
                                /{project.milestones.length}
                    </span>
                  </div>
                  {project.milestones.length ? (
                    <div className="life-milestone-list">
                      {project.milestones.map(milestone => (
                                  <label
                                    className="life-milestone"
                                    key={milestone.id}
                                  >
                          <input
                            type="checkbox"
                            checked={milestone.done}
                            disabled={readOnly}
                            aria-label={`Mark milestone ${milestone.title} ${milestone.done ? "incomplete" : "complete"}`}
                            onChange={event =>
                              updateProject(project.id, current => ({
                                ...current,
                                          milestones: current.milestones.map(
                                            item =>
                                  item.id === milestone.id
                                                ? {
                                                    ...item,
                                                    done: event.target.checked,
                                                  }
                                    : item
                                ),
                              }))
                            }
                          />
                          <span>{milestone.title}</span>
                          <input
                            type="date"
                            className="milestone-date"
                            aria-label={`Date for milestone ${milestone.title}`}
                            disabled={readOnly}
                            value={
                              project.schedule.milestoneDates.find(
                                item => item.id === milestone.id
                              )?.date ?? ""
                            }
                            onClick={event => event.stopPropagation()}
                            onChange={event => {
                              const date = event.target.value;
                              updateProject(project.id, current => ({
                                ...current,
                                schedule: {
                                  ...current.schedule,
                                  milestoneDates: [
                                    ...current.schedule.milestoneDates.filter(
                                      item => item.id !== milestone.id
                                    ),
                                    ...(date
                                      ? [{ id: milestone.id, date }]
                                      : []),
                                  ],
                                },
                              }));
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="small muted">
                                Add a milestone only when it is useful evidence
                                of movement; it will not automatically achieve
                                the outcome.
                    </p>
                  )}
                  <div className="inline-field life-inline-add">
                    <input
                      aria-label={`New milestone for ${project.title}`}
                      value={milestoneDraft}
                      maxLength={240}
                      placeholder="Add a concrete milestone"
                      disabled={readOnly}
                      onChange={event =>
                        setMilestoneDrafts(current => ({
                          ...current,
                          [project.id]: event.target.value,
                        }))
                      }
                      onKeyDown={event => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addMilestone(project.id);
                        }
                      }}
                    />
                    <button
                      className="button secondary"
                      type="button"
                      disabled={readOnly || !milestoneDraft.trim()}
                      onClick={() => addMilestone(project.id)}
                    >
                      <Plus size={15} /> Add
                    </button>
                  </div>
                </div>

                <div className="life-project-section">
                  <div className="section-heading">
                    <div>
                      <div className="eyebrow">OBSERVED EVIDENCE</div>
                      <h2>What you can point to</h2>
                    </div>
                  </div>
                  <p className="small muted">
                              Save dated evidence rather than a
                              pseudo-percentage of progress.
                  </p>
                  {project.progress.length ? (
                    <div className="life-evidence-list">
                                {[...project.progress]
                                  .reverse()
                                  .map((entry, index) => (
                                    <p
                                      className="history"
                                      key={`${entry.at}-${index}`}
                                    >
                          <time>{entry.at.slice(0, 10)}</time>
                          {entry.text}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="small muted">
                                No observed evidence yet. A note such as “bench
                                cleared” or “first customer enquiry received” is
                                enough.
                    </p>
                  )}
                  <div className="inline-field life-inline-add">
                    <input
                      aria-label={`Observed evidence for ${project.title}`}
                      value={evidenceDraft}
                      maxLength={1000}
                      placeholder="Record what you observed"
                      disabled={readOnly}
                      onChange={event =>
                        setEvidenceDrafts(current => ({
                          ...current,
                          [project.id]: event.target.value,
                        }))
                      }
                      onKeyDown={event => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addEvidence(project.id);
                        }
                      }}
                    />
                    <button
                      className="button secondary"
                      type="button"
                      disabled={readOnly || !evidenceDraft.trim()}
                      onClick={() => addEvidence(project.id)}
                    >
                      <Plus size={15} /> Save evidence
                    </button>
                  </div>
                </div>

                <div className="life-project-section">
                  <div className="section-heading">
                    <div>
                      <div className="eyebrow">LINKED NEXT TASKS</div>
                      <h2>Small steps held with this outcome</h2>
                    </div>
                    {(nextStep || project.status === "achieved") && (
                      <button
                        className="button secondary small-button"
                        disabled={readOnly}
                        onClick={() => onAddTask(project.id)}
                      >
                        <Plus size={15} /> Add small task
                      </button>
                    )}
                  </div>
                  {linkedTasks.length ? (
                    <div className="life-linked-tasks">
                      {linkedTasks.map(task => {
                        const state = derivedState(task, workspace.tasks);
                        return (
                          <button
                            className="work-row-main life-linked-task"
                            key={task.id}
                            aria-label={`Open linked task ${task.title}`}
                            onClick={() => onOpenTask(task)}
                          >
                            <strong>
                              <TimingShapeMark task={task} /> {task.title}
                            </strong>
                            <span>
                              {task.nextAction || "Choose a small next step."}
                            </span>
                            <span className={`state-tag state-${state}`}>
                              {stateLabel(state)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="small muted">
                                There are no linked next tasks. Add one small,
                                physical step when you are ready to carry this
                                forward.
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
                </AccordionSection>
              ))}
            </div>
          )}
        </>
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
              <select
                aria-label="Project role"
                value={draft.role}
                disabled={readOnly}
                onChange={event =>
                  patch("role", event.target.value as LifeRole)
                }
              >
                <option value="direction">Direction</option>
                <option value="support">Support</option>
              </select>
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
              <ImperativePicker
                selected={draft.compass.imperativeIds}
                imperatives={imperatives}
                onChange={imperativeIds =>
                  patch("compass", { ...draft.compass, imperativeIds })
                }
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
  onMutate,
  onOpenTask,
  readOnly,
}: Pick<Props, "workspace" | "onMutate" | "onOpenTask" | "readOnly">) {
  const activeTasks = useMemo(
    () => workspace.tasks.filter(task => task.state !== "done"),
    [workspace.tasks]
  );
  const commitments = useMemo(
    () => attention(workspace.tasks).commitments,
    [workspace.tasks]
  );
  const byCell = useMemo(() => {
    const groups: Record<MatrixCell, Task[]> = {
      "direction-timely": [],
      "direction-sustained": [],
      "support-timely": [],
      "support-sustained": [],
    };
    for (const task of activeTasks) {
      const key = matrixKey(task);
      if (key) groups[key].push(task);
    }
    return groups;
  }, [activeTasks]);
  const unclassified = activeTasks.filter(task => !matrixKey(task));

  const weightFor = (cell: MatrixCell) => {
    const existing = workspace.matrixWeights?.[cell];
    return Number.isInteger(existing) && existing! >= 1 && existing! <= 3
      ? existing!
      : DEFAULT_MATRIX_WEIGHTS[cell];
  };
  const setWeight = (cell: MatrixCell, value: number) => {
    if (readOnly) return;
    onMutate(current => ({
      ...current,
      matrixWeights: {
        ...DEFAULT_MATRIX_WEIGHTS,
        ...(current.matrixWeights ?? {}),
        [cell]: value,
      },
    }));
  };

  return (
    <>
      <div className="page-heading life-heading">
        <div className="eyebrow">MY LIFE · BALANCED VIEW</div>
        <h1>See the parts that could disappear from view.</h1>
        <p>
          Direction and support sit side by side. Timely and sustained are
          patterns, not a value ranking.
        </p>
      </div>

      <div className="life-matrix-grid">
        {(Object.keys(CELL_DETAILS) as MatrixCell[]).map(cell => {
          const detail = CELL_DETAILS[cell];
          const tasks = byCell[cell];
          return (
            <section className="settings-section life-matrix-cell" key={cell}>
              <div className="section-heading">
                <div>
                  <div className="eyebrow">{tasks.length} HELD HERE</div>
                  <h2>{detail.title}</h2>
                </div>
                <label className="life-emphasis-control">
                  <span>Emphasis</span>
                  <select
                    aria-label={`Emphasis for ${detail.title}`}
                    value={weightFor(cell)}
                    disabled={readOnly}
                    onChange={event =>
                      setWeight(cell, Number(event.target.value))
                    }
                  >
                    <option value={1}>1 · balanced</option>
                    <option value={2}>2 · gentle</option>
                    <option value={3}>3 · stronger</option>
                  </select>
                </label>
              </div>
              <p className="small muted">{detail.description}</p>
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
                      <span>{identityLabel(task)}</span>
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
            <h2>Emphasis breaks ties; it does not decide.</h2>
          </div>
          <ClipboardCheck size={20} aria-hidden="true" />
        </div>
        <p>
          Every cell starts balanced at 1. A little more emphasis can help when
          otherwise comparable choices need a tie-breaker. It never changes
          readiness, replaces Compass, or hides a real commitment.
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
          This independent list is not changed by matrix emphasis. It is a
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
