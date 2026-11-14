import React, { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, Info, Unlink } from "lucide-react";
import { toast } from "sonner";
import { adelaideTimestamp } from "../../../../shared/time";
import { adelaideClock } from "../../domain/time";
import { poolTasks } from "../../domain/anchorPlanning";
import {
  clockText,
  keepGoing,
  removePrerequisites,
  todayPlan,
  type Chip,
  type TodayRow,
} from "../../domain/todayPlan";
import type { Task, Workspace } from "../../domain/types";
import CardDotsMark from "./CardDotsMark";
import ListProgressMark, { hasListProgress } from "./ListProgressMark";
import { attachedWithoutRun, newListRunId, startRun } from "../../domain/lists";

interface Props {
  workspace: Workspace;
  tasks: Task[];
  readOnly: boolean;
  attentionCount: number;
  /** The weekday check-in line, shown above Now when a question is set. */
  checkIn?: ReactNode;
  onAttention: () => void;
  onOverview: () => void;
  onDone: (id: string) => boolean;
  onFinishedEarly: (task: Task) => boolean;
  onStart: (task: Task) => void;
  onOpenFocus: () => void;
  onOpen: (task: Task) => void;
  onMove: (task: Task) => void;
  onDrop: (id: string) => boolean;
  onMutate: (change: (w: Workspace) => Workspace) => boolean | void;
  /** Make a task today's Next thing (WHEN trigger + one small DO action). */
  onChoose: (taskId: string, when: string, doAction: string) => boolean;
}

export const TODAY_INFO =
  "Now is what's booked or running. Next is your chosen Next thing, or the next booking. Later is everything else dated or booked for today, by time. Green bar: serves an Imperative. Dashed: suggested, tap to confirm. Faded with dots: not set up yet. Grey chips show only what's off normal; red means it will clash.";

function Chips({ chips }: { chips: Chip[] }) {
  if (!chips.length) return null;
  return (
    <span className="tp-chips">
      {chips.map(chip => (
        <span key={chip.kind} className={`tp-chip${chip.red ? " tp-chip--red" : ""}`}>
          {chip.text}
        </span>
      ))}
    </span>
  );
}

function rowClass(row: TodayRow, extra = ""): string {
  return [
    "tp-row",
    row.green ? "tp-green" : "",
    row.faded ? "tp-faded" : "",
    row.suggested ? "tp-suggested" : "",
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}

function RowMain({ row, tasks, time, onOpen, workspace }: { row: TodayRow; tasks: Task[]; time: string; onOpen: () => void; workspace?: Workspace }) {
  const list = hasListProgress(workspace, row.task.id);
  return (
    <button type="button" className="tp-row-main" onClick={onOpen}>
      <span className="tp-time">{time}</span>
      <span className="tp-title-wrap">
        <span className="tp-title">{row.task.title}</span>
        {(row.label || row.suggested || row.chips.length > 0 || row.brokenLink || row.faded || list) && (
          <span className="tp-signals">
            <Chips chips={row.chips} />
            <ListProgressMark workspace={workspace} id={row.task.id} chipCount={row.chips.length} />
            {row.brokenLink && <Unlink size={16} className="tp-broken" role="img" aria-label="Missing its Goal Outcome or Imperative link" />}
            {row.faded && <CardDotsMark task={row.task} tasks={tasks} />}
            {(row.label || row.suggested) && (
              <span className="tp-meta">
                {[row.label, row.suggested ? "suggested · tap to confirm" : null].filter(Boolean).join(" · ")}
              </span>
            )}
          </span>
        )}
      </span>
      <ChevronRight size={16} className="tp-open" aria-hidden="true" />
    </button>
  );
}

const OFFER_KEY = "steadier.listOffer.notNow.v1";

/**
 * On the Now card: a task with a list attached offers to start a run of it.
 * "Not now" folds it away for that task today.
 */
function ListOffer({
  workspace,
  taskId,
  readOnly,
  onMutate,
}: {
  workspace: Workspace;
  taskId: string;
  readOnly: boolean;
  onMutate: Props["onMutate"];
}) {
  const day = adelaideClock().date;
  const key = `${OFFER_KEY}:${day}:${taskId}`;
  const [notNow, setNotNow] = useState(() => {
    try {
      return globalThis.localStorage?.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  const template = attachedWithoutRun(workspace, "task", taskId)[0];
  if (!template || notNow || readOnly) return null;
  return (
    <div className="tp-list-offer">
      <span>Start the {template.title} list too?</span>
      <span className="tp-list-offer-actions">
        <button
          type="button"
          className="tp-btn tp-btn-primary"
          onClick={() => {
            const ok = onMutate(w => startRun(w, newListRunId(), template.id, adelaideTimestamp(), { kind: "task", id: taskId }));
            if (ok !== false) toast(`${template.title} started.`);
          }}
        >
          Start list
        </button>
        <button
          type="button"
          className="lv-link"
          onClick={() => {
            try {
              globalThis.localStorage?.setItem(key, "1");
            } catch {
              /* without storage it simply stays */
            }
            setNotNow(true);
          }}
        >
          Not now
        </button>
      </span>
    </div>
  );
}

export default function TodayPlanView(p: Props) {
  const [clock, setClock] = useState(() => adelaideClock());
  const [info, setInfo] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickId, setPickId] = useState<string | null>(null);
  const [pickDo, setPickDo] = useState("");
  const [showAllPool, setShowAllPool] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => setClock(adelaideClock()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const plan = useMemo(
    () => todayPlan(p.workspace, p.tasks, clock.date, clock.minutes),
    [p.workspace, p.tasks, clock.date, clock.minutes]
  );
  const minute = clock.minutes;

  const keep = (row: TodayRow) => {
    if (p.readOnly) return;
    const stamp = adelaideTimestamp();
    const ok = p.onMutate(w => ({
      ...w,
      tasks: w.tasks.map(t => (t.id === row.task.id ? keepGoing(t, clock.date, minute, row.likelyEnd, stamp) : t)),
    }));
    if (ok === false) toast.error("That wasn't saved. Check sync and try again.");
  };
  const drop = (task: Task) => {
    if (p.readOnly) return;
    if (!window.confirm(`Drop “${task.title}” from today? It stays in All work; nothing is deleted.`)) return;
    p.onDrop(task.id);
  };
  const unblock = (row: TodayRow) => {
    if (p.readOnly) return;
    const titles = row.blockedBy.map(t => t.title);
    if (!window.confirm(`Remove ${titles.length === 1 ? "the prerequisite" : "these prerequisites"} from “${row.task.title}”?\n\n${titles.join("\n")}\n\nThe other task${titles.length === 1 ? " stays" : "s stay"} as ${titles.length === 1 ? "it is" : "they are"}.`)) return;
    const stamp = adelaideTimestamp();
    const ok = p.onMutate(w => ({
      ...w,
      tasks: w.tasks.map(t =>
        t.id === row.task.id ? removePrerequisites(t, row.blockedBy.map(b => b.id), titles, stamp) : t
      ),
    }));
    if (ok === false) toast.error("That wasn't saved. Check sync and try again.");
  };
  const blocked = (row: TodayRow) =>
    row.blockedBy.length > 0 && (
      <div className="tp-extra">
        <p className="tp-blocked">Blocked by: {row.blockedBy.map(t => t.title).join(", ")}</p>
        <div className="tp-actions">
          <button type="button" className="tp-btn" disabled={p.readOnly} onClick={() => p.onMove(row.task)}>
            Move it
          </button>
          <button type="button" className="tp-btn" disabled={p.readOnly} onClick={() => unblock(row)}>
            Remove prerequisite
          </button>
        </div>
      </div>
    );

  const pool = poolTasks(p.tasks, clock.date, minute);
  const choose = (task: Task) => {
    const doAction = pickDo.trim() || task.nextAction.trim();
    if (!doAction) return;
    if (p.onChoose(task.id, "now", doAction)) {
      setPickId(null);
      setPickDo("");
      setPicking(false);
    }
  };
  const picker = pool.length === 0 ? (
    <p className="tp-meta">Nothing is waiting. Use + to add something.</p>
  ) : (
    <ul className="tp-pick">
      {(showAllPool ? pool : pool.slice(0, 6)).map(task => (
        <li key={task.id}>
          {pickId === task.id ? (
            <form
              className="tp-pick-form"
              onSubmit={event => {
                event.preventDefault();
                choose(task);
              }}
            >
              <span className="tp-title">{task.title}</span>
              <label className="tp-meta" htmlFor={`pick-do-${task.id}`}>First small action</label>
              <input
                id={`pick-do-${task.id}`}
                value={pickDo}
                maxLength={500}
                onChange={e => setPickDo(e.target.value)}
                placeholder="e.g. Open the laptop"
                autoFocus
              />
              <div className="tp-actions">
                <button type="submit" className="tp-btn" disabled={p.readOnly || !(pickDo.trim() || task.nextAction.trim())}>
                  Make it my Next thing
                </button>
                <button type="button" className="tp-btn" onClick={() => setPickId(null)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="tp-pick-item"
              disabled={p.readOnly}
              onClick={() => {
                setPickId(task.id);
                setPickDo(task.nextAction);
              }}
            >
              {task.title}
            </button>
          )}
        </li>
      ))}
      {!showAllPool && pool.length > 6 && (
        <li>
          <button type="button" className="tp-link" onClick={() => setShowAllPool(true)}>
            Show all {pool.length}
          </button>
        </li>
      )}
    </ul>
  );

  const now = plan.now;
  let progress: { at: number; end: number; likely: number } | null = null;
  if (now && now.mode === "block" && now.start !== null && now.end !== null) {
    const likely = Math.max(now.end, now.likelyEnd ?? now.end);
    const span = Math.max(1, likely - now.start);
    progress = {
      at: Math.min(100, Math.max(0, ((minute - now.start) / span) * 100)),
      end: ((now.end - now.start) / span) * 100,
      likely,
    };
  }

  return (
    <div className="tp">
      {p.checkIn}
      <div className="tp-head">
        <h2 className="tp-label">Now</h2>
        <button
          type="button"
          className="tp-info-button"
          aria-label="What Today shows"
          aria-expanded={info}
          onClick={() => setInfo(v => !v)}
        >
          <Info size={18} aria-hidden="true" />
        </button>
      </div>
      {info && (
        <p className="tp-info" role="note">
          {TODAY_INFO}
        </p>
      )}

      {now ? (
        <section id="today-now" className={rowClass(now, "tp-now")} aria-label="Now">
          <button type="button" className="tp-now-title" onClick={() => p.onOpen(now.task)}>
            <span className="tp-title">{now.task.title}</span>
            {now.brokenLink && <Unlink size={17} className="tp-broken" role="img" aria-label="Missing its Goal Outcome or Imperative link" />}
          </button>
          <p className="tp-meta">
            {now.mode === "block" && now.start !== null && now.end !== null
              ? `${clockText(now.start)} – ${clockText(now.end)}${now.likelyEnd !== null && now.likelyEnd !== now.end ? ` · likely finish ${clockText(now.likelyEnd)}` : ""}`
              : now.mode === "upnext" && now.start !== null
                ? `Up next in ${now.minutesUntil! >= 60 ? `${Math.floor(now.minutesUntil! / 60)}h ${now.minutesUntil! % 60}m` : `${now.minutesUntil} min`} · ${clockText(now.start)}`
                : now.mode === "focus"
                ? "Focus running"
                : [plan.next === null && p.workspace.nextThing?.when ? p.workspace.nextThing.when : null, now.label].filter(Boolean).join(" · ") || "Your Next thing"}
          </p>
          {(now.chips.length > 0 || hasListProgress(p.workspace, now.task.id)) && (
            <span className="tp-signals">
              <Chips chips={now.chips} />
              <ListProgressMark workspace={p.workspace} id={now.task.id} chipCount={now.chips.length} />
            </span>
          )}
          <ListOffer workspace={p.workspace} taskId={now.task.id} readOnly={p.readOnly} onMutate={p.onMutate} />
          {progress && (
            <div className="tp-progress" role="img" aria-label={`Now ${clockText(minute)}; block ends ${clockText(now.end!)}`}>
              <div className="tp-track" />
              <div className="tp-fill" style={{ width: `${progress.at}%` }} />
              {progress.end < 100 && <div className="tp-likely" style={{ left: `${progress.end}%`, right: 0 }} />}
              <div className="tp-nowmark" style={{ left: `${progress.at}%` }} />
            </div>
          )}
          {progress && (
            <div className="tp-times">
              <span>{clockText(now.start!)}</span>
              <span className="tp-now-text">now {clockText(minute)}</span>
              <span>{clockText(progress.likely)}</span>
            </div>
          )}
          {blocked(now)}
          <div className="tp-now-actions">
            {now.mode === "next" || now.mode === "upnext" ? (
              <>
                <button type="button" className="tp-big" disabled={p.readOnly} onClick={() => p.onStart(now.task)}>
                  Start
                </button>
                <button type="button" className="tp-big tp-big--second" disabled={p.readOnly} onClick={() => p.onDone(now.task.id)}>
                  Done
                </button>
              </>
            ) : (
              <>
                <button type="button" className="tp-big" disabled={p.readOnly} onClick={() => p.onDone(now.task.id)}>
                  Done
                </button>
                {now.mode === "block" ? (
                  <button type="button" className="tp-big tp-big--second" disabled={p.readOnly} onClick={() => p.onFinishedEarly(now.task)}>
                    Finished early
                  </button>
                ) : (
                  <button type="button" className="tp-big tp-big--second" onClick={p.onOpenFocus}>
                    Return to focus
                  </button>
                )}
              </>
            )}
          </div>
          {now.mode === "upnext" && !picking && (
            <button type="button" className="tp-link" onClick={() => setPicking(true)}>
              Pick a Next thing instead
            </button>
          )}
          {now.mode === "upnext" && picking && picker}
        </section>
      ) : (
        <section className="tp-row tp-now tp-empty" aria-label="Now">
          <p className="tp-title">Nothing booked now. Pick a Next thing:</p>
          {picker}
        </section>
      )}

      {plan.slipped.map(row => (
        <section key={row.task.id} className={rowClass(row)} aria-label={`Slipped: ${row.task.title}`}>
          <RowMain row={row} tasks={p.tasks} workspace={p.workspace} time={row.timeText} onOpen={() => p.onOpen(row.task)} />
          <div className="tp-extra">
            {row.again && <p className="tp-meta">Slipped again. It'll be in your Weekly Review if you leave it.</p>}
            <div className={`tp-actions${row.again ? "" : " tp-actions--three"}`}>
              {!row.again && (
                <button type="button" className="tp-btn" disabled={p.readOnly} onClick={() => keep(row)}>
                  Keep going
                </button>
              )}
              <button type="button" className="tp-btn" disabled={p.readOnly} onClick={() => p.onMove(row.task)}>
                Move
              </button>
              <button type="button" className="tp-btn" disabled={p.readOnly} onClick={() => drop(row.task)}>
                Drop
              </button>
            </div>
          </div>
        </section>
      ))}

      {plan.next && (
        <>
          <h2 className="tp-label">Next</h2>
          <section className={rowClass(plan.next)} aria-label="Next">
            <RowMain
              row={plan.next}
              tasks={p.tasks}
              time={plan.next.start !== null ? plan.next.timeText : plan.next.when ? plan.next.when : plan.next.timeText}
              onOpen={() => p.onOpen(plan.next!.task)}
            />
            {blocked(plan.next)}
          </section>
        </>
      )}

      {plan.later.length > 0 && (
        <>
          <h2 className="tp-label">Later</h2>
          <div className="tp-list">
            {plan.later.map(row => (
              <section key={row.task.id} className={rowClass(row)} aria-label={row.task.title}>
                <RowMain row={row} tasks={p.tasks} workspace={p.workspace} time={row.timeText} onOpen={() => p.onOpen(row.task)} />
                {blocked(row)}
              </section>
            ))}
          </div>
        </>
      )}

      {p.attentionCount > 0 && (
        <button type="button" className="tp-attention" onClick={p.onAttention}>
          <span>Needs attention ({p.attentionCount})</span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
