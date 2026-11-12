import { useContext, useState } from "react";
import TimeChips from "./TimeChips";
import {
  ArrowRight,
  Check,
  Clock3,
  ArrowUpRight,
  ChevronDown,
} from "lucide-react";
import type {
  AttentionItem,
  AttentionResult,
  Context,
  Task,
  Project,
} from "../../domain/types";
import { identityLabel } from "../../domain/life";
import { derivedState, today } from "../../domain/engine";
import { countLabel, kindCounts, taskKind } from "../../domain/todayStates";
import { TaskKindContext, useKindClass } from "./TaskStates";
import TimingShapeMark from "./TimingShapeMark";

interface Props {
  /** "today": other tasks under the Now card. "overview": the wider view. */
  part: "today" | "overview";
  tasks: Task[];
  projects: Project[];
  onProjects: () => void;
  result: AttentionResult;
  /** Task already shown as Now / Next, left out of Other tasks. */
  excludeIds?: string[];
  context: Context;
  minutes: number;
  onContext: (v: Context) => void;
  onMinutes: (v: number) => void;
  onOpen: (t: Task) => void;
  onStart: (t: Task) => void;
  onDone: (id: string) => void;
  onDefer: (id: string) => void;
  onAll: (filter?: string) => void;
  onReview: () => void;
  onWaiting: () => void;
}
function actionCopy(item: AttentionItem, tasks: Task[]) {
  if (item.kind === "followup")
    return `Follow up: ${item.task.waitingFor || "check whether the expected reply or event has happened."}`;
  if (item.kind === "clarify") return "";
  if (item.kind === "review" && derivedState(item.task, tasks) !== "ready")
    return "Check what has changed, then choose a next step or a review date.";
  return item.task.nextAction;
}

export default function AttentionView(p: Props) {
  return p.part === "today" ? <OtherTasks {...p} /> : <Overview {...p} />;
}

function OtherTasks(p: Props) {
  const exclude = new Set(p.excludeIds ?? []);
  const items = p.result.items.filter(i => !exclude.has(i.task.id));
  const kinds = useContext(TaskKindContext);
  const counts = kinds ? kindCounts(p.tasks, kinds.ctx) : null;
  return (
    <section className="other-tasks" aria-labelledby="other-title">
      <div className="section-heading compact">
        <h2 id="other-title">Other tasks</h2>
        <div className="context-bar inline">
          <select
            aria-label="Current context"
            value={p.context}
            onChange={e => p.onContext(e.target.value as Context)}
          >
            <option value="anywhere">Any context</option>
            <option value="home">At home</option>
            <option value="computer">At computer</option>
            <option value="out">Out & about</option>
          </select>
          <select
            aria-label="Available time"
            value={p.minutes}
            onChange={e => p.onMinutes(Number(e.target.value))}
          >
            <option value={0}>Any time</option>
            <option value={5}>5 min</option>
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
            <option value={60}>1 hour</option>
          </select>
        </div>
      </div>
      {items.length ? (
        items.map(item => <OtherRow key={item.task.id} item={item} {...p} />)
      ) : (
        <div className="line-row">Nothing else fits these filters.</div>
      )}
      <button className="line-link" onClick={() => p.onAll()}>
        <b>All work</b>
        <span>{counts ? countLabel(counts) : ""}</span>
        <ArrowRight size={14} />
      </button>
    </section>
  );
}

function OtherRow({ item, ...p }: Props & { item: AttentionItem }) {
  const [open, setOpen] = useState(false);
  const kindClass = useKindClass(item.task);
  const t = item.task;
  const step = actionCopy(item, p.tasks);
  const project = p.projects.find(x => x.id === t.projectId);
  const contributes = project?.outcome || project?.title || t.purpose;
  const ready = derivedState(t, p.tasks) === "ready";
  return (
    <article className={`other-row${kindClass}`}>
      <button
        className="other-main"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <strong>{t.title}</strong>
        {step && <span className="task-step">{step}</span>}
        <span className="other-meta">
          {[formatEstimate(t), ...item.reason.split(" · ")]
            .filter(part => part && !part.startsWith("Next:"))
            .join(" · ")}
        </span>
        <TimeChips task={t} />
        <ChevronDown size={16} aria-hidden="true" className="chev" />
      </button>
      {open && (
        <div className="other-more">
          <p className="small muted">{identityLabel(t)}</p>
          {contributes && (
            <p>
              <span className="lbl">Contributes to</span> {contributes}
            </p>
          )}
          {t.notes && <p className="now-notes">{t.notes}</p>}
          <div className="other-actions">
            <button
              className="now-second"
              onClick={() => (ready ? p.onStart(t) : p.onOpen(t))}
            >
              {ready ? "Start" : "Open"}
            </button>
            <button
              className="icon-button"
              aria-label={`Complete ${t.title}`}
              onClick={() => p.onDone(t.id)}
            >
              <Check size={18} />
            </button>
            <button className="text-button" onClick={() => p.onDefer(t.id)}>
              <Clock3 size={14} /> Not today
            </button>
            <button className="text-button" onClick={() => p.onOpen(t)}>
              Details <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function formatEstimate(t: Task): string {
  const m = t.schedule.minutes ?? t.estimate ?? 15;
  return m >= 60 ? `${Math.round((m / 60) * 10) / 10} h` : `${m} min`;
}

function Overview(p: Props) {
  const kinds = useContext(TaskKindContext);
  const completedToday = p.tasks.filter(t =>
    t.completedAt?.startsWith(today())
  ).length;
  // Held tasks due for review first (existing review logic), then other held.
  const isHeld = (t: Task) =>
    kinds ? taskKind(t, kinds.ctx) === "held" : true;
  const dueHeld = p.result.reviewDue.filter(isHeld);
  const held = [
    ...dueHeld,
    ...p.tasks.filter(
      t => isHeld(t) && t.state !== "done" && !dueHeld.includes(t)
    ),
  ];
  const allCounts = kinds ? kindCounts(p.tasks, kinds.ctx) : null;
  const waiting = p.result.waitingCount + p.result.blockedCount;
  const moving = p.projects.filter(project => project.status === "active");
  return (
    <div className="overview">
      <section aria-labelledby="held-title">
        <div className="section-heading compact">
          <h2 id="held-title">Held</h2>
          {allCounts && (
            <span className="small muted">{allCounts.held} in total</span>
          )}
        </div>
        {held.length ? (
          held
            .slice(0, 2)
            .map(task => (
              <HeldRow key={task.id} task={task} onOpen={p.onOpen} />
            ))
        ) : (
          <div className="line-row">Nothing held is due for review.</div>
        )}
        <button className="line-link" onClick={() => p.onAll("held")}>
          <b>See all held</b>
          <span>{allCounts ? allCounts.held : ""}</span>
          <ArrowRight size={14} />
        </button>
        {dueHeld.length > 2 && (
          <button className="line-link" onClick={p.onReview}>
            <b>Review the rest</b>
            <span>{dueHeld.length - 2} more due</span>
            <ArrowRight size={14} />
          </button>
        )}
        <button className="line-link" onClick={p.onWaiting}>
          <b>Waiting & blocked</b>
          <span>{waiting || "None"}</span>
          <ArrowRight size={14} />
        </button>
      </section>

      <section aria-labelledby="moving-title">
        <div className="section-heading compact">
          <h2 id="moving-title">What is moving</h2>
        </div>
        {moving.length ? (
          moving.slice(0, 3).map(project => (
            <button
              key={project.id}
              className="moving-row"
              onClick={p.onProjects}
            >
              <span>
                <strong>
                  <TimingShapeMark project={project} /> {project.title}
                </strong>
                <span className="task-step">
                  {project.progress.at(-1)?.text ||
                    project.outcome ||
                    "Choose a visible milestone."}
                </span>
              </span>
              <ArrowUpRight size={15} />
            </button>
          ))
        ) : (
          <div className="line-row">No active projects.</div>
        )}
        <button className="line-link" onClick={p.onProjects}>
          <b>Projects & outcomes</b>
          <ArrowRight size={14} />
        </button>
      </section>

      <div className="line-row progress-line">
        <Check size={15} aria-hidden="true" />
        {completedToday
          ? `${completedToday} ${completedToday === 1 ? "thing" : "things"} moved forward today`
          : "Small starts count, too"}
      </div>
    </div>
  );
}

function HeldRow(p: { task: Task; onOpen: (t: Task) => void }) {
  const kindClass = useKindClass(p.task);
  return (
    <button
      className={`other-row held-row${kindClass}`}
      onClick={() => p.onOpen(p.task)}
    >
      <span className="other-main as-span">
        <strong>{p.task.title}</strong>
        {p.task.nextAction && (
          <span className="task-step">{p.task.nextAction}</span>
        )}
        <TimeChips task={p.task} />
      </span>
    </button>
  );
}
