import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  Compass,
  Lightbulb,
  X,
} from "lucide-react";
import type { AttentionResult, Task, Workspace } from "../../domain/types";
import { pendingPlacement, activeImperatives } from "../../domain/compass";
import { buildCalendar } from "../../domain/calendarModel";
import { isTaskAnchor } from "../../domain/anchorPlanning";
import { missedBlocks } from "../../domain/planning";
import { reminderInstants } from "../../domain/reminders";
import { derivedState } from "../../domain/engine";
import {
  adelaideClock,
  formatDuration,
  formatTime,
  minutesToTime,
  slotMinutes,
  timeToMinutes,
} from "../../domain/time";
import {
  needsClarify,
  pendingHomeLabel,
  suggestionSource,
} from "../../domain/todayStates";
import { StateMark, useKindClass } from "./TaskStates";
import TimingShapeMark from "./TimingShapeMark";

const CLARIFY_KEY = "steadier.clarifyDismissed.v1";

function loadDismissed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(CLARIFY_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(
      Array.isArray(list) ? list.filter(x => typeof x === "string") : []
    );
  } catch {
    return new Set();
  }
}

interface Props {
  workspace: Workspace;
  tasks: Task[];
  result: AttentionResult;
  orphanCount: number;
  readOnly: boolean;
  onDone: (id: string) => boolean;
  onNotNow: (id: string) => boolean;
  onStart: (task: Task) => void;
  onOpenFocus: () => void;
  onFinishedEarly: (task: Task) => boolean;
  onOpen: (task: Task) => void;
  onConfirmPlacement: (task: Task) => void;
  onOpenOrphans: () => void;
  onReview: () => void;
  onCommitments: () => void;
  onCalendar: () => void;
  onImperatives: () => void;
  /** Faded (not set up) tasks waiting in Sort. */
  sortCount?: number;
  ideaCount?: number;
  onSort?: () => void;
  onIdeas?: () => void;
}

type NowMode = "block" | "focus" | "focusDone";

export default function TodayNow(p: Props) {
  const [clock, setClock] = useState(() => adelaideClock());
  useEffect(() => {
    const id = window.setInterval(() => setClock(adelaideClock()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);
  const [expanded, setExpanded] = useState(false);
  const [justDone, setJustDone] = useState<string | null>(null);
  useEffect(() => {
    if (!justDone) return;
    const id = window.setTimeout(() => setJustDone(null), 7000);
    return () => window.clearTimeout(id);
  }, [justDone]);

  const day = clock.date;
  const minute = clock.minutes;
  const dayCalendar = useMemo(
    () => buildCalendar(p.tasks, p.workspace.projects, [day], day)[0],
    [p.tasks, p.workspace.projects, day]
  );
  const timed = dayCalendar?.timed.filter(
    item => item.fixed && item.kind !== "deadline" && item.start !== undefined && item.taskId
  ) ?? [];
  const currentBlock = timed.find(item => {
    const start = item.start ?? 0;
    return start <= minute && start + (item.minutes ?? 0) > minute;
  });
  const currentTask = currentBlock
    ? p.tasks.find(task => task.id === currentBlock.taskId)
    : undefined;
  const focusTask = p.tasks.find(task => task.id === p.workspace.focus?.taskId);
  const nowTask = currentTask ?? focusTask;
  const mode: NowMode | null = currentTask
    ? "block"
    : focusTask
      ? focusTask.state === "done" ? "focusDone" : "focus"
      : null;

  const open = p.tasks.filter(task => task.state !== "done" && !task.droppedAt);
  const placements = open.filter(task => pendingPlacement(task));
  const slipped = missedBlocks(p.tasks, day, minute).length;
  const nowDate = new Date();
  const laterReminders = open
    .flatMap(reminderInstants)
    .filter(
      reminder =>
        reminder.at > nowDate &&
        adelaideClock(reminder.at).date === day &&
        reminder.at.getTime() - nowDate.getTime() < 86_400_000
    )
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const tiles: {
    key: string;
    n: number;
    label: string;
    onClick: () => void;
  }[] = [
    { key: "sort", n: p.sortCount ?? 0, label: "Sort", onClick: () => p.onSort?.() },
    { key: "place", n: p.orphanCount, label: "To place", onClick: p.onOpenOrphans },
    { key: "review", n: p.result.reviewDue.length, label: "Needs review", onClick: p.onReview },
    { key: "due", n: p.result.commitments.length, label: "Due soon", onClick: p.onCommitments },
    {
      key: "slipped",
      n: slipped,
      label: "Slipped anchors",
      onClick: p.onCalendar,
    },
  ].filter(tile => tile.n > 0);
  const attentionTotal = tiles.reduce((sum, tile) => sum + tile.n, 0) + laterReminders.length;

  const dismissClarify = (id: string) => {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    try {
      window.localStorage.setItem(CLARIFY_KEY, JSON.stringify([...next].slice(-300)));
    } catch {
      /* the prompt simply returns next visit */
    }
  };

  const complete = (task: Task) => {
    if (p.onDone(task.id)) setJustDone(task.title);
  };
  const notNow = (task: Task) => {
    if (p.onNotNow(task.id)) setJustDone(null);
  };

  const imperatives = activeImperatives(p.workspace).length;
  const blocksToday = timed.length;

  return (
    <div className="today-now-stack">
      {justDone && (
        <div className="just-done" role="status">
          <Check size={16} aria-hidden="true" />
          <span>Done: <strong>{justDone}</strong></span>
        </div>
      )}
      {nowTask && mode && (
        <NowCard
          task={nowTask}
          mode={mode}
          minute={minute}
          tasks={p.tasks}
          workspace={p.workspace}
          expanded={expanded}
          onToggle={() => setExpanded(value => !value)}
          clarify={needsClarify(nowTask, dismissed)}
          onDismissClarify={() => dismissClarify(nowTask.id)}
          readOnly={p.readOnly}
          onDone={() => complete(nowTask)}
          onNotNow={() => notNow(nowTask)}
          onFinishedEarly={() => p.onFinishedEarly(nowTask)}
          onStart={() => p.onStart(nowTask)}
          onOpenFocus={p.onOpenFocus}
          onOpen={() => p.onOpen(nowTask)}
          onCalendar={p.onCalendar}
        />
      )}

      {placements.slice(0, 2).map(task => (
        <article key={task.id} className="placement-card kind-suggested">
          <button className="placement-main" onClick={() => p.onOpen(task)}>
            <strong>{task.title}</strong>
            <span><Compass size={13} aria-hidden="true" /> {pendingHomeLabel(task, p.workspace)}</span>
            <span className="source-tag">Suggested by {suggestionSource(task)}</span>
          </button>
          <button className="confirm-button" disabled={p.readOnly} onClick={() => p.onConfirmPlacement(task)}>
            Confirm
          </button>
        </article>
      ))}
      {placements.length > 2 && (
        <button className="line-link" onClick={p.onOpenOrphans}>
          {placements.length - 2} more suggested <ArrowRight size={14} />
        </button>
      )}

      {attentionTotal > 0 ? (
        <section className="attention-card" aria-labelledby="needs-title">
          <div className="attention-head">
            <span id="needs-title" className="lbl">Needs attention</span>
            <span className="count-badge">{attentionTotal}</span>
          </div>
          <div className="attention-tiles">
            {tiles.map(tile => (
              <button key={tile.key} className="attn-tile" onClick={tile.onClick}>
                <span className="n">{tile.n}</span> {tile.label}
              </button>
            ))}
            {laterReminders.length > 0 && (
              <button
                className="attn-tile"
                onClick={() => {
                  const task = open.find(item => item.id === laterReminders[0].taskId);
                  if (task) p.onOpen(task);
                }}
              >
                <Bell size={15} aria-hidden="true" />
                <span className="n">{laterReminders.length}</span> Reminder{laterReminders.length === 1 ? "" : "s"} ·{" "}
                {formatTime(minutesToTime(adelaideClock(laterReminders[0].at).minutes))}
              </button>
            )}
          </div>
        </section>
      ) : (
        <div className="line-row"><Check size={15} aria-hidden="true" /> Nothing needs attention</div>
      )}

      <button className="line-link" onClick={p.onCalendar}>
        <CalendarDays size={15} aria-hidden="true" />
        <b>Calendar</b>
        <span>{blocksToday ? `${blocksToday} booked anchor${blocksToday === 1 ? "" : "s"} today` : "No booked anchors today"}</span>
        <ArrowRight size={14} />
      </button>
      {p.onIdeas && (
        <button className="line-link" onClick={p.onIdeas}>
          <Lightbulb size={15} aria-hidden="true" />
          <b>Ideas</b>
          <span>{p.ideaCount ? `${p.ideaCount} on the shelf` : "Shelf is empty"}</span>
          <ArrowRight size={14} />
        </button>
      )}
      <button className="line-link" onClick={p.onImperatives}>
        <Compass size={15} aria-hidden="true" />
        <b>Imperatives</b>
        <span>{imperatives ? `${imperatives} active` : "None set"}</span>
        <ArrowRight size={14} />
      </button>
    </div>
  );
}

function NowCard(p: {
  task: Task;
  mode: NowMode;
  minute: number;
  tasks: Task[];
  workspace: Workspace;
  expanded: boolean;
  onToggle: () => void;
  clarify: boolean;
  onDismissClarify: () => void;
  readOnly: boolean;
  onDone: () => void;
  onNotNow: () => void;
  onFinishedEarly: () => void;
  onStart: () => void;
  onOpenFocus: () => void;
  onOpen: () => void;
  onCalendar: () => void;
}) {
  const kindClass = useKindClass(p.task);
  const task = p.task;
  const block = p.mode === "block" && task.schedule.time;
  const start = block ? timeToMinutes(task.schedule.time!) : 0;
  const length = slotMinutes(task);
  const end = start + length;
  const progress = block
    ? Math.min(100, Math.max(0, ((p.minute - start) / length) * 100))
    : 0;
  const project = p.workspace.projects.find(item => item.id === task.projectId);
  const contributes = project?.outcome || project?.title || task.purpose;
  const mayReturnToPool = p.mode === "focus" && !isTaskAnchor(task);
  return (
    <section id="today-now" className={`now-card${kindClass}`} aria-labelledby="now-title">
      <div className="now-head">
        <span className="lbl">{p.mode === "block" ? "Booked now" : "Focus in progress"}</span>
        <StateMark task={task} />
        <TimingShapeMark task={task} />
      </div>
      <button className="now-title" id="now-title" aria-expanded={p.expanded} onClick={p.onToggle}>
        <span>{task.title}</span>
        <ChevronDown size={18} aria-hidden="true" className="chev" />
      </button>
      {task.nextAction ? (
        <p className="now-next"><span className="lbl">Next action</span> {task.nextAction}</p>
      ) : p.clarify ? (
        <div className="clarify-prompt">
          <button className="text-button" onClick={p.onOpen}>Clarify next step <ArrowRight size={14} /></button>
          <button className="icon-button small-icon" aria-label="Dismiss" onClick={p.onDismissClarify}><X size={15} /></button>
        </div>
      ) : null}
      {block ? (
        <div className="now-block">
          <div className="now-bar" role="img" aria-label={`Now is ${Math.round(progress)}% through this booked anchor`}>
            <div className="now-fill" style={{ width: `${progress}%` }} />
            <div className="now-tick" style={{ left: `${progress}%` }}><span>now</span></div>
          </div>
          <div className="now-times">
            <span>{formatTime(task.schedule.time)}</span>
            <span>{formatDuration(Math.max(0, end - p.minute))} left</span>
            <span>{formatTime(minutesToTime(end))}</span>
          </div>
        </div>
      ) : (
        <p className="now-meta">{formatDuration(task.schedule.minutes ?? task.estimate ?? 15)}</p>
      )}
      {p.expanded && (
        <div className="now-more">
          {contributes && <p><span className="lbl">Contributes to</span> {contributes}</p>}
          {task.notes && <p className="now-notes">{task.notes}</p>}
          <p className="small muted">{task.area}{task.context !== "anywhere" ? ` · ${task.context}` : ""}</p>
          <button className="text-button" onClick={p.onOpen}>Open details <ArrowRight size={14} /></button>
        </div>
      )}
      <div className="now-actions">
        {p.mode === "block" ? (
          <>
            <button className="now-main" disabled={p.readOnly} onClick={p.onDone}><Check size={22} aria-hidden="true" /> Done</button>
            <button className="now-second" disabled={p.readOnly} onClick={p.onFinishedEarly}>Finished early</button>
          </>
        ) : p.mode === "focus" ? (
          <>
            <button className="now-main" disabled={p.readOnly} onClick={p.onDone}><Check size={22} aria-hidden="true" /> Done</button>
            <button className="now-second" onClick={p.onOpenFocus}>Return to focus</button>
          </>
        ) : (
          <>
            <span className="now-meta">Complete · timer continues</span>
            <button className="now-second" onClick={p.onOpenFocus}>Return to timer</button>
          </>
        )}
      </div>
      <div className="now-links">
        {p.mode === "block" ? (
          <button className="text-button" onClick={p.onCalendar}>Move this anchor in Calendar <ArrowRight size={14} /></button>
        ) : mayReturnToPool ? (
          <button className="text-button" disabled={p.readOnly} onClick={p.onNotNow}>Not now · return to pool</button>
        ) : null}
      </div>
    </section>
  );
}
