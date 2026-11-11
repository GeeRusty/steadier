import TimeChips from "./TimeChips";
import TimingShapeMark from "./TimingShapeMark";
import React, { useContext, useEffect, useMemo, useState } from "react";
import { TaskKindContext } from "./TaskStates";
import { countLabel, kindCounts, taskKind } from "../../domain/todayStates";
import {
  ArrowRight,
  Check,
  Search,
  RefreshCw,
  Clock3,
  Plus,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { nestRows } from "../../domain/subtasks";
import { isFaded, notReadyTasks } from "../../domain/taskCard";
import CardDotsMark from "./CardDotsMark";
import { isTaskAnchor, pastDueTasks } from "../../domain/anchorPlanning";
import type { Task, View, Project } from "../../domain/types";
import { identityLabel } from "../../domain/life";
import {
  attention,
  derivedState,
  stateLabel,
  deadlineLabel,
  today,
  daysUntil,
} from "../../domain/engine";
import {
  adelaideClock,
  flexibleWindowState,
  formatDuration,
} from "../../domain/time";
import { areaIcon } from "./AttentionView";
import AccordionSection from "./AccordionSection";
import { groupByStable, monthGroup } from "../../domain/accordionGroups";
interface Props {
  view: View;
  tasks: Task[];
  projects: Project[];
  search: string;
  area: string;
  filter: string;
  onSearch: (v: string) => void;
  onArea: (v: string) => void;
  onFilter: (v: string) => void;
  onOpen: (t: Task) => void;
  onStart: (t: Task) => void;
  onDone: (id: string) => void;
  onReview: (id: string) => void;
  onAdd: () => void;
}
export default function WorkViews(p: Props) {
  const [page, setPage] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const kinds = useContext(TaskKindContext);
  const kindOf = (task: Task) => {
    const kind = kinds ? taskKind(task, kinds.ctx) : null;
    return kind ? ` kind-${kind}` : "";
  };
  const toggle = (id: string) =>
    setCollapsed(c => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  useEffect(
    () => setPage(0),
    [p.view, p.search, p.area, p.filter, p.tasks.length]
  );
  const now = today();
  const adelaideToday = adelaideClock().date;
  const activeFlexibleTasks = p.tasks.filter(task => {
    const window = task.schedule.flexibleWindow;
    return (
      !!window &&
      task.state !== "done" &&
      ["active", "closes-today"].includes(
        flexibleWindowState(window, adelaideToday)
      )
    );
  });
  const explicitWindowEffort = activeFlexibleTasks.reduce(
    (sum, task) => sum + (task.schedule.minutes ?? 0),
    0
  );
  const result = useMemo(() => attention(p.tasks, { now }), [p.tasks, now]);
  const areas = [...new Set(p.tasks.map(t => t.area))];
  const headings: Record<string, [string, string]> = {
    all: [
      "The whole picture.",
      "Everything is here. You only need to work on a little of it.",
    ],
    review: [
      "A small check-in.",
      "Fill the gaps that matter: next steps, provisional identity and when to return. This is not another deadline.",
    ],
    waiting: [
      "Some things need time.",
      "Waiting is a real state. Name the missing piece, and return when it makes sense.",
    ],
    areas: [
      "The parts of your life.",
      "Stable places to find things. Not a hierarchy you have to climb to begin.",
    ],
    progress: [
      "You moved things forward.",
      "A record of completed steps and what changed. Projects & outcomes holds the larger picture.",
    ],
  };
  const [title, sub] = headings[p.view] || headings.all;
  const pastDueIds = new Set(pastDueTasks(p.tasks, today()).map(t => t.id));
  const notReadyCount = notReadyTasks(p.tasks).length;
  const list = p.tasks.filter(task => {
    const state = derivedState(task, p.tasks);
    if (p.view === "progress" ? task.state !== "done" : task.state === "done")
      return false;
    if (
      p.view === "review" &&
      !result.reviewDue.some(t => t.id === task.id) &&
      task.state !== "inbox" &&
      task.labelSource === "confirmed"
    )
      return false;
    if (p.view === "waiting" && !["waiting", "blocked"].includes(state))
      return false;
    if (p.area && task.area !== p.area) return false;
    if (
      p.filter === "commitments" &&
      !result.commitments.some(t => t.id === task.id)
    )
      return false;
    if (p.filter === "direction" || p.filter === "support") {
      if (task.role !== p.filter) return false;
    } else if (p.filter === "timely" || p.filter === "sustained") {
      if (task.pattern !== p.filter) return false;
    } else if (p.filter === "unclassified") {
      if (task.role && task.pattern && task.labelSource === "confirmed")
        return false;
    } else if (p.filter === "notready") {
      if (!isFaded(task, p.tasks)) return false;
    } else if (p.filter === "pastdue") {
      if (!pastDueIds.has(task.id)) return false;
    } else if (p.filter === "preparation") {
      if (!task.preparationDate || daysUntil(task.preparationDate, now) > 0)
        return false;
    } else if (
      p.filter === "held" ||
      p.filter === "active" ||
      p.filter === "suggested"
    ) {
      const kind = kinds ? taskKind(task, kinds.ctx) : null;
      if (p.filter === "active") {
        if (kind !== "scheduled" && kind !== "chosen") return false;
      } else if (kind !== p.filter) return false;
    } else if (p.filter && p.filter !== "commitments" && state !== p.filter)
      return false;
    const project = p.projects.find(project => project.id === task.projectId);
    return `${task.title} ${task.nextAction} ${task.notes} ${task.area} ${task.waitingFor} ${task.purpose} ${task.role || ""} ${task.pattern || ""} ${project?.title || ""} ${project?.outcome || ""}`
      .toLowerCase()
      .includes(p.search.toLowerCase());
  });
  // Subtasks sit under their parents; a subtask whose parent is filtered
  // out stays at the left and names its parent instead.
  const rows = nestRows(list, p.tasks, collapsed);
  const pages = Math.max(1, Math.ceil(rows.length / 25));
  const safePage = Math.min(page, pages - 1);
  const pageRows = rows.slice(safePage * 25, safePage * 25 + 25);
  const groupedView = ["all", "waiting", "progress"].includes(p.view);
  const rowGroups = groupByStable(pageRows, row => {
    if (p.view === "waiting") {
      const state = derivedState(row.task, p.tasks);
      return { key: state, label: state === "blocked" ? "Blocked" : "Waiting" };
    }
    if (p.view === "progress") return monthGroup(row.task.completedAt);
    const project = p.projects.find(item => item.id === row.task.projectId);
    return project
      ? { key: project.id, label: project.title }
      : { key: "unlinked", label: "No linked Project" };
  });
  const isUrgent = (task: Task) =>
    isTaskAnchor(task) &&
    [task.deadline, task.preparationDate, task.schedule.date, task.reviewDate]
      .some(date => Boolean(date && date <= now));
  const renderRow = (row: (typeof rows)[number]) => {
    const task = row.task;
    const state = derivedState(task, p.tasks);
    const dependencies = task.dependencies.filter(
      id => p.tasks.find(t => t.id === id)?.state !== "done"
    );
    return (
      <article
        key={task.id}
        className={`work-row${row.depth ? " is-subtask" : ""}${kindOf(task)}${isFaded(task, p.tasks) ? " work-row--faded" : ""}`}
        style={
          row.depth
            ? { marginLeft: `${Math.min(row.depth, 4) * 1.25}rem` }
            : undefined
        }
      >
        {row.progress.total > 0 ? (
          <button
            className="subtask-toggle"
            aria-expanded={!row.collapsed}
            aria-label={`${row.collapsed ? "Show" : "Hide"} subtasks of ${task.title}`}
            onClick={() => toggle(task.id)}
          >
            {row.collapsed ? (
              <ChevronRight size={16} />
            ) : (
              <ChevronDown size={16} />
            )}
          </button>
        ) : (
          <span className="subtask-toggle-spacer" aria-hidden />
        )}
        <label
          className={`work-row-done-tick${task.state === "done" ? " is-done" : ""}`}
        >
          <input
            type="checkbox"
            aria-label={
              task.state === "done"
                ? `${task.title} is done`
                : `Mark ${task.title} done`
            }
            checked={task.state === "done"}
            disabled={task.state === "done"}
            onChange={() => p.onDone(task.id)}
          />
          <span>Done</span>
        </label>
        <button
          className="work-row-main"
          aria-label={`Open task ${task.title}`}
          onClick={() => p.onOpen(task)}
        >
          <strong>{task.title}</strong>
          {isFaded(task, p.tasks) && <CardDotsMark task={task} tasks={p.tasks} />}
          {task.droppedAt && (
            <span className="dropped-decision-tag">Dropped — kept decision</span>
          )}
          <span className="identity-label">{identityLabel(task)}</span>
          <span>
            {task.nextAction || "Choose one small next physical step."}
          </span>
          {task.projectId && (
            <span className="small contribution-note">
              Outcome:{" "}
              {p.projects.find(project => project.id === task.projectId)
                ?.outcome ||
                p.projects.find(project => project.id === task.projectId)
                  ?.title}
            </span>
          )}
          {task.state === "done" && task.progressEvidence && (
            <span className="progress-evidence">
              What changed: {task.progressEvidence}
            </span>
          )}
          <span className="work-row-open-hint">
            <ChevronRight size={14} aria-hidden="true" /> View task details
          </span>
          {task.preparationDate && (
            <span className="small muted">
              {task.preparationSource === "suggested"
                ? "Suggested preparation"
                : "Preparation planned"}
              : {task.preparationDate}
            </span>
          )}
          {["waiting", "blocked"].includes(state) && (
            <span className="waiting-reason">
              {task.waitingFor ||
                (dependencies.length
                  ? `Prerequisite: ${dependencies.map(id => p.tasks.find(t => t.id === id)?.title || "missing task").join(", ")}`
                  : "Name the missing piece.")}
              {task.reviewDate && ` · Review ${task.reviewDate}`}
            </span>
          )}
        </button>
        <div className="work-row-meta">
          <span className={`state-tag state-${state}`}>
            {stateLabel(state)}
          </span>
          <span>
            {task.area} · {deadlineLabel(task)}
          </span>
          <TimeChips task={task} hideParent={row.depth > 0} />
        </div>
        {p.view === "review" &&
        task.state !== "inbox" &&
        task.labelSource === "confirmed" ? (
          <button
            className="button secondary small-button"
            onClick={() => p.onReview(task.id)}
          >
            <RefreshCw size={14} /> Reviewed
          </button>
        ) : state === "ready" ? (
          <button
            className="icon-button"
            aria-label={`Start ${task.title}`}
            onClick={() => p.onStart(task)}
          >
            <ArrowRight size={18} />
          </button>
        ) : (
          <button
            className="icon-button"
            aria-label={`Open ${task.title}`}
            onClick={() => p.onOpen(task)}
          >
            <ArrowRight size={18} />
          </button>
        )}
      </article>
    );
  };
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">
          {p.view === "progress"
            ? "A RECORD OF PROGRESS"
            : "A TRUSTED PLACE FOR EVERYTHING"}
        </div>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      {p.view === "all" && (
        <p className="work-row-guidance">
          Tap <strong>View task details</strong> to inspect a task. Use the separate Done tick to complete it.
        </p>
      )}
      {p.view === "all" && activeFlexibleTasks.length > 0 && (
        <aside
          className="flex-window-summary"
          aria-label="Active flexible windows"
        >
          <div>
            <strong>Flexible windows in progress</strong>
            <span className="small muted">
              {activeFlexibleTasks.length} open
              {explicitWindowEffort
                ? ` · ${formatDuration(explicitWindowEffort)} explicitly estimated`
                : " · no effort estimates entered"}
            </span>
          </div>
          <div className="flex-window-summary-links">
            {activeFlexibleTasks.slice(0, 4).map(task => (
              <button
                type="button"
                key={task.id}
                className="text-button"
                onClick={() => p.onOpen(task)}
              >
                <TimingShapeMark task={task} /> {task.title}
              </button>
            ))}
            {activeFlexibleTasks.length > 4 && (
              <span className="small muted">
                +{activeFlexibleTasks.length - 4} more in the list
              </span>
            )}
          </div>
        </aside>
      )}
      {p.view === "areas" && (
        <div className="area-directory">
          {areas.map(a => {
            const items = p.tasks.filter(
              t => t.area === a && t.state !== "done"
            );
            const Icon = areaIcon(a);
            return (
              <button
                key={a}
                className={`directory-area ${p.area === a ? "selected" : ""}`}
                onClick={() => p.onArea(p.area === a ? "" : a)}
              >
                <Icon size={24} />
                <h2>{a}</h2>
                <p>
                  {kinds
                    ? countLabel(kindCounts(items, kinds.ctx))
                    : `${items.length} open`}
                </p>
                <span className="text-button">
                  Explore area
                  <ArrowRight size={15} />
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="library-toolbar">
        <label className="library-search">
          <Search size={18} />
          <input
            value={p.search}
            onChange={e => p.onSearch(e.target.value)}
            placeholder="Find a responsibility or next step…"
            aria-label="Search all responsibilities"
          />
        </label>
        <select
          aria-label="Filter by life area"
          value={p.area}
          onChange={e => p.onArea(e.target.value)}
        >
          <option value="">All areas</option>
          {areas.map(a => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <select
          aria-label="Filter by workflow"
          value={p.filter}
          onChange={e => p.onFilter(e.target.value)}
        >
          <option value="">Every state</option>
          <option value="pastdue">Past due (date or window passed)</option>
          <option value="held">Held</option>
          <option value="active">Active (scheduled or chosen)</option>
          <option value="suggested">Suggested</option>
          <option value="ready">Can start</option>
          <option value="notready">Not ready ({notReadyCount})</option>
          <option value="waiting">Waiting</option>
          <option value="blocked">Blocked</option>
          <option value="scheduled">Not available yet</option>
          <option value="deferred">Set aside</option>
          <option value="someday">Ideas (Someday)</option>
          <option value="direction">Direction</option>
          <option value="support">Support</option>
          <option value="timely">Timely</option>
          <option value="sustained">Sustained</option>
          <option value="unclassified">Identity to clarify / confirm</option>
          <option value="preparation">Preparation date reached</option>
          <option value="commitments">Approaching / passed commitments</option>
        </select>
      </div>
      <div className="list-heading">
        <span>
          {list.length}{" "}
          {list.length === 1 ? "responsibility" : "responsibilities"}
          {p.area ? ` in ${p.area}` : ""}
          {kinds && p.view !== "progress" && (
            <span className="list-kinds">
              {" · "}
              {countLabel(kindCounts(list, kinds.ctx))}
            </span>
          )}
        </span>
        <span className="small muted">
          {p.view === "review"
            ? "Acknowledge review ≠ complete work"
            : "Select any row to see the next step"}
        </span>
      </div>
      {groupedView ? (
        <div className="accordion-group-list work-list-groups">
          {rowGroups.map((group, index) => {
            const urgent = group.items.some(row => {
              if (p.view === "progress")
                return (
                  monthGroup(row.task.completedAt).key === monthGroup(now).key
          );
              return isUrgent(row.task);
            });
          return (
              <AccordionSection
                key={group.key}
                persistenceKey={group.key}
                title={group.label}
                count={group.items.length}
                collapsible={pageRows.length > 5}
                defaultOpen={index === 0 || urgent}
                autoOpen={urgent}
                revealToken={p.search && group.items.length ? p.search : ""}
                className={`work-list-group work-list-group-${p.view}`}
                >
                <div className="work-list">{group.items.map(renderRow)}</div>
              </AccordionSection>
          );
        })}
      </div>
      ) : (
        <div className="work-list">{pageRows.map(renderRow)}</div>
      )}
      {!list.length && (
        <div className="empty-state">
          <Check size={30} />
          <h2>
            {p.tasks.length ? "Nothing in this view." : "A fresh, quiet space."}
          </h2>
          <p>
            {p.tasks.length
              ? "Try clearing the filters, or check another view. Your collection is still held here."
              : "Add one responsibility. You do not have to organise your whole life first."}
          </p>
          <button className="button secondary" onClick={p.onAdd}>
            <Plus size={16} />
            Capture a responsibility
          </button>
        </div>
      )}
      {pages > 1 && (
        <div className="pagination">
          <button
            className="button secondary"
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
          >
            Previous
          </button>
          <span className="small">
            Page {safePage + 1} of {pages}
          </span>
          <button
            className="button secondary"
            disabled={safePage >= pages - 1}
            onClick={() => setPage(safePage + 1)}
          >
            Next
          </button>
        </div>
      )}
      {p.view === "waiting" && (
        <p className="footnote">
          <Clock3 size={15} />A due review means it is time to check or follow
          up. It does not mean the blocker has gone away.
        </p>
      )}
      {p.view === "progress" && (
        <p className="footnote">
          <Check size={15} />
          {p.tasks.filter(t => t.completedAt?.startsWith(today())).length}{" "}
          completed today. Undo can reverse the most recent change in this
          session.
        </p>
      )}
    </>
  );
}
