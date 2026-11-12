import TimeChips from "./TimeChips";
import TimingShapeMark from "./TimingShapeMark";
import { Info, Unlink } from "lucide-react";
import { useStatusMarkData } from "./TaskStates";
import { taskChips, taskHasBrokenLink, clockText } from "../../domain/todayPlan";
import { pendingPlacement } from "../../domain/compass";
import { friendlyDate } from "../../domain/quickParse";

/** One grey date/time chip, or nothing. */
export function whenChip(task: Task, today: string): string | null {
  const s = task.schedule;
  const time = s.time ? clockText(timeToMinutesSafe(s.time)) : null;
  if (s.date) {
    const day = s.date === today ? (time ? "" : "today") : friendlyDate(s.date, today);
    return [day, time].filter(Boolean).join(" ") || null;
  }
  if (s.flexibleWindow) return `${friendlyDate(s.flexibleWindow.startDate, today)}–${friendlyDate(s.flexibleWindow.endDate, today)}`;
  if (task.deadline && task.deadline >= today) return `due ${task.deadline === today ? "today" : friendlyDate(task.deadline, today)}`;
  return null;
}
function timeToMinutesSafe(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
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
import type { Imperative } from "../../domain/compass";
import { effectiveTaskRole, rowLabel } from "../../domain/linkCheck";
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
import AccordionSection from "./AccordionSection";
import { groupByStable, monthGroup } from "../../domain/accordionGroups";
interface Props {
  view: View;
  tasks: Task[];
  projects: Project[];
  /** For the hybrid matrix row (linked to an active Imperative). */
  imperatives?: Imperative[];
  search: string;
  filter: string;
  onSearch: (v: string) => void;
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
    [p.view, p.search, p.filter, p.tasks.length]
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
    progress: [
      "You moved things forward.",
      "A record of completed steps and what changed. Projects & outcomes holds the larger picture.",
    ],
  };
  const [title, sub] = headings[p.view] || headings.all;
  const [info, setInfo] = useState(false);
  const [openOutcomes, setOpenOutcomes] = useState<Set<string>>(() => new Set());
  const markData = useStatusMarkData();
  const pastDueIds = new Set(pastDueTasks(p.tasks, today()).map(t => t.id));
  const notReadyCount = notReadyTasks(p.tasks).length;
  const links = { imperatives: p.imperatives ?? [], projects: p.projects };
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
    if (
      p.filter === "commitments" &&
      !result.commitments.some(t => t.id === task.id)
    )
      return false;
    if (p.filter === "direction" || p.filter === "support") {
      if (effectiveTaskRole(task, links) !== p.filter) return false;
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
    return `${task.title} ${task.nextAction} ${task.notes} ${task.waitingFor} ${task.purpose} ${task.role || ""} ${task.pattern || ""} ${project?.title || ""} ${project?.outcome || ""}`
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
      : { key: "unlinked", label: "No project" };
  });
  const isUrgent = (task: Task) =>
    isTaskAnchor(task) &&
    [task.deadline, task.preparationDate, task.schedule.date, task.reviewDate]
      .some(date => Boolean(date && date <= now));
  const ctx = { day: now, minute: adelaideClock().minutes, lastReviewDate: markData?.lastWeeklyReviewDate ?? null };
  const renderRow = (row: (typeof rows)[number]) => {
    const task = row.task;
    const state = derivedState(task, p.tasks);
    const done = task.state === "done";
    const faded = isFaded(task, p.tasks);
    const suggested = pendingPlacement(task) !== null;
    const green = effectiveTaskRole(task, links) === "direction";
    const broken = markData ? taskHasBrokenLink(task, markData) : false;
    const when = done ? null : whenChip(task, now);
    const chips = done
      ? []
      : [
          state === "blocked" ? "blocked" : state === "waiting" ? "waiting" : null,
          ...taskChips(task, ctx).map(c => c.text),
        ]
          .filter((c): c is string => !!c)
          .slice(0, 2);
    const signals = when || chips.length || broken || faded || suggested || task.droppedAt;
    return (
      <article
        key={task.id}
        className={`wr${row.depth ? " is-subtask" : ""}${green ? " wr-green" : ""}${suggested ? " wr-suggested" : ""}${faded ? " wr-faded" : ""}${done ? " wr-done" : ""}`}
        style={row.depth ? { marginLeft: `${Math.min(row.depth, 4) * 1.25}rem` } : undefined}
      >
        <button
          type="button"
          className="wr-tick"
          aria-label={done ? `${task.title} is done` : `Mark ${task.title} done`}
          aria-pressed={done}
          disabled={done}
          onClick={() => p.onDone(task.id)}
        >
          <span className="wr-circle">{done && <Check size={16} aria-hidden="true" />}</span>
        </button>
        <button className="wr-main" aria-label={`Open task ${task.title}`} onClick={() => p.onOpen(task)}>
          <span className="tp-title">{task.title}</span>
          {signals && (
            <span className="tp-signals">
              {when && <span className="tp-chip">{when}</span>}
              {chips.map(text => (
                <span key={text} className="tp-chip">
                  {text}
                </span>
              ))}
              {broken && <Unlink size={16} className="tp-broken" role="img" aria-label="Missing its Goal Outcome or Imperative link" />}
              {faded && <CardDotsMark task={task} tasks={p.tasks} />}
              {suggested && <span className="tp-meta">suggested · tap to confirm</span>}
              {task.droppedAt && <span className="tp-meta">dropped · kept</span>}
            </span>
          )}
          {p.view === "progress" && done && task.progressEvidence && (
            <span className="tp-meta">What changed: {task.progressEvidence}</span>
          )}
        </button>
        {row.progress.total > 0 && (
          <button
            className="wr-sub"
            aria-expanded={!row.collapsed}
            aria-label={`${row.collapsed ? "Show" : "Hide"} subtasks of ${task.title}`}
            onClick={() => toggle(task.id)}
          >
            {row.progress.done}/{row.progress.total}
            {row.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
        {p.view === "review" && task.state !== "inbox" && task.labelSource === "confirmed" && (
          <button className="tp-btn" onClick={() => p.onReview(task.id)}>
            Reviewed
          </button>
        )}
      </article>
    );
  };
  const outcomeOf = (key: string) => p.projects.find(project => project.id === key)?.outcome?.trim() || "";
  const placeGroup = (task: Task) =>
    task.compass?.catchAllConfirmed && task.compass.catchAll === "life-admin"
      ? "Life Admin"
      : task.compass?.catchAllConfirmed && task.compass.catchAll === "erosion-guard"
        ? "Erosion Guard"
        : "Not placed";
  const renderGroupBody = (group: (typeof rowGroups)[number]) => {
    if (p.view !== "all") return <div className="work-list">{group.items.map(renderRow)}</div>;
    if (group.key === "unlinked") {
      return (
        <div className="work-list">
          {(["Life Admin", "Erosion Guard", "Not placed"] as const).map(name => {
            const items = group.items.filter(row => placeGroup(row.task) === name);
            if (!items.length) return null;
            return (
              <React.Fragment key={name}>
                <h3 className="wr-subgroup">{name}</h3>
                {items.map(renderRow)}
              </React.Fragment>
            );
          })}
        </div>
      );
    }
    const outcome = outcomeOf(group.key);
    return (
      <div className="work-list">
        {outcome && (
          <button
            type="button"
            className={`wr-outcome${openOutcomes.has(group.key) ? " is-open" : ""}`}
            aria-expanded={openOutcomes.has(group.key)}
            onClick={() =>
              setOpenOutcomes(current => {
                const next = new Set(current);
                if (next.has(group.key)) next.delete(group.key);
                else next.add(group.key);
                return next;
              })
            }
          >
            Outcome: {outcome}
          </button>
        )}
        {group.items.map(renderRow)}
      </div>
    );
  };
  return (
    <>
      <div className="work-head">
        {p.view !== "all" && <h1 className="work-title">{title}</h1>}
        <button
          type="button"
          className="tp-info-button"
          aria-label="What this page shows"
          aria-expanded={info}
          onClick={() => setInfo(v => !v)}
        >
          <Info size={18} aria-hidden="true" />
        </button>
      </div>
      {info && (
        <p className="tp-info" role="note">
          {sub} Tap a row to open it; the Done box completes it.
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
          <option value="direction">Imperative</option>
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
          {list.length} {list.length === 1 ? "task" : "tasks"}
        </span>
        {p.view === "review" && (
          <span className="small muted">Acknowledge review ≠ complete work</span>
        )}
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
                {renderGroupBody(group)}
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
