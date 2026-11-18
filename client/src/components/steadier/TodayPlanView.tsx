import React, { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, Info, Unlink } from "lucide-react";
import { toast } from "sonner";
import { adelaideTimestamp } from "../../../../shared/time";
import { adelaideClock } from "../../domain/time";
import { poolTasks } from "../../domain/anchorPlanning";
import {
  clockText,
  delta,
  keepGoing,
  LATE_THRESHOLD_MINUTES,
  removePrerequisites,
  todayPlan,
  type AgendaEntry,
  type Chip,
  type NowRow,
  type TodayRow,
  type WeekDay,
} from "../../domain/todayPlan";
import type { Task, Workspace } from "../../domain/types";
import CardDotsMark from "./CardDotsMark";
import PhotoCountMark from "./PhotoCountMark";
import { photosOf } from "../../domain/photos";
import ListProgressMark, { hasListProgress } from "./ListProgressMark";
import { attachedWithoutRun, newListRunId, startRun } from "../../domain/lists";

interface Props {
  workspace: Workspace;
  tasks: Task[];
  readOnly: boolean;
  attentionCount: number;
  /** The weekday check-in line, shown at the top when a question is set. */
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
  /** Open a list directly from a card's list progress. */
  onOpenList?: (templateId: string) => void;
  /** "+ Add" on a Free row: capture something for today at this minute. */
  onAddAt?: (minute: number) => void;
}

export const TODAY_INFO =
  "Now shows only what's running: a booked block in progress, or your focus timer. Next thing is the one you chose, never the next booking. Any time today is dated for today with no clock time. Below is the day in time order, with the red now line; gaps over an hour show as Free. Green bar: serves an Imperative. Dashed: suggested, tap to confirm. Faded with dots: not set up yet. Faded rows are over or done. Grey chips show only what's off normal; red means it will clash.";

/** "in 25 min" / "in 1h 22m". */
export function inText(minutes: number): string {
  return minutes >= 60 ? `in ${delta(minutes)}` : `in ${minutes} min`;
}

/** Agenda card height: grows with length, capped so one long block can't take the screen. */
export function agendaHeight(minutes: number): number {
  return Math.round(52 + Math.min(1, Math.max(0, (minutes - 30) / 150)) * 44);
}

function DoneCircle({ done, title, disabled, onDone }: { done: boolean; title: string; disabled: boolean; onDone: () => void }) {
  if (done)
    return (
      <span className="tp-circle" role="img" aria-label={`Done: ${title}`}>
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10" className="tp-circle-fill" />
          <path d="M7 12.5l3 3 7-7" className="tp-circle-tick" />
        </svg>
      </span>
    );
  return (
    <button type="button" className="tp-circle" aria-label={`Done: ${title}`} disabled={disabled} onClick={onDone}>
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" className="tp-circle-ring" />
      </svg>
    </button>
  );
}

function WeekStrip({ week }: { week: WeekDay[] }) {
  const most = Math.max(60, ...week.map(d => d.bookedMinutes));
  return (
    <ol className="tp-week" aria-label="This week's booked time">
      {week.map(d => (
        <li
          key={d.date}
          className={`tp-week-day${d.today ? " tp-week-today" : ""}`}
          aria-current={d.today ? "date" : undefined}
          aria-label={`${d.weekday} ${d.dayOfMonth}${d.bookedMinutes ? `, ${delta(d.bookedMinutes)} booked` : ", nothing booked"}`}
        >
          <span aria-hidden="true">{d.weekday}</span>
          <b aria-hidden="true">{d.dayOfMonth}</b>
          <span className="tp-week-mark" aria-hidden="true" style={{ width: d.bookedMinutes ? `${Math.max(6, Math.round((d.bookedMinutes / most) * 28))}px` : 0 }} />
        </li>
      ))}
    </ol>
  );
}

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

function RowMain({ row, tasks, time, onOpen, workspace, onOpenList }: { row: TodayRow; tasks: Task[]; time: string; onOpen: () => void; workspace?: Workspace; onOpenList?: (templateId: string) => void }) {
  const list = hasListProgress(workspace, row.task.id);
  return (
    <button type="button" className="tp-row-main" onClick={onOpen}>
      <span className="tp-time">{time}</span>
      <span className="tp-title-wrap">
        <span className="tp-title">{row.task.title}</span>
        {(row.label || row.suggested || row.chips.length > 0 || row.brokenLink || row.faded || list || photosOf(row.task).length > 0 || row.leaveBy !== null) && (
          <span className="tp-signals">
            {row.leaveBy !== null && <span className="tp-meta tp-leave">leave by {clockText(row.leaveBy)}</span>}
            <Chips chips={row.chips} />
            <ListProgressMark workspace={workspace} id={row.task.id} chipCount={row.chips.length} onOpenList={onOpenList} />
            <PhotoCountMark task={row.task} />
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
              <span className="tp-title">
                {task.title} <PhotoCountMark task={task} />
              </span>
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
              <PhotoCountMark task={task} />
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

  const signals = (row: TodayRow, withLeave = true) => {
    const list = hasListProgress(p.workspace, row.task.id);
    if (!(row.label || row.suggested || row.chips.length > 0 || row.brokenLink || row.faded || list || photosOf(row.task).length > 0 || (withLeave && row.leaveBy !== null))) return null;
    return (
      <span className="tp-signals">
        {withLeave && row.leaveBy !== null && <span className="tp-meta tp-leave">leave by {clockText(row.leaveBy)}</span>}
        <Chips chips={row.chips} />
        <ListProgressMark workspace={p.workspace} id={row.task.id} chipCount={row.chips.length} onOpenList={p.onOpenList} />
        <PhotoCountMark task={row.task} />
        {row.brokenLink && <Unlink size={16} className="tp-broken" role="img" aria-label="Missing its Goal Outcome or Imperative link" />}
        {row.faded && <CardDotsMark task={row.task} tasks={p.tasks} />}
        {(row.label || row.suggested) && (
          <span className="tp-meta">{[row.label, row.suggested ? "suggested · tap to confirm" : null].filter(Boolean).join(" · ")}</span>
        )}
      </span>
    );
  };

  const nowCard = (now: NowRow) => {
    let progress: { at: number; end: number; likely: number } | null = null;
    if (now.mode === "block" && now.start !== null && now.end !== null) {
      const likely = Math.max(now.end, now.likelyEnd ?? now.end);
      const span = Math.max(1, likely - now.start);
      progress = {
        at: Math.min(100, Math.max(0, ((minute - now.start) / span) * 100)),
        end: ((now.end - now.start) / span) * 100,
        likely,
      };
    }
    const both = plan.now.length > 1;
    const meta =
      now.mode === "block" && now.start !== null && now.end !== null
        ? `${both ? "Booked now · " : ""}${clockText(now.start)} – ${clockText(now.end)}${now.likelyEnd !== null && Math.abs(now.likelyEnd - now.end) >= LATE_THRESHOLD_MINUTES ? ` · likely finish ${clockText(now.likelyEnd)}` : ""}${now.focusRunning ? " · focus running" : ""}`
        : `Your focus timer · ${now.focusRunning ? "running" : "paused"}`;
    return (
      <section key={`${now.mode}:${now.task.id}`} id={plan.now[0] === now ? "today-now" : undefined} className={rowClass(now, "tp-now")} aria-label={now.mode === "block" ? "Now: booked" : "Now: your focus"}>
        <button type="button" className="tp-now-title" onClick={() => p.onOpen(now.task)}>
          <span className="tp-title">{now.task.title}</span>
          {now.brokenLink && <Unlink size={17} className="tp-broken" role="img" aria-label="Missing its Goal Outcome or Imperative link" />}
        </button>
        <p className="tp-meta">{meta}</p>
        {(now.chips.length > 0 || hasListProgress(p.workspace, now.task.id) || photosOf(now.task).length > 0) && (
          <span className="tp-signals">
            <Chips chips={now.chips} />
            <ListProgressMark workspace={p.workspace} id={now.task.id} chipCount={now.chips.length} onOpenList={p.onOpenList} />
            <PhotoCountMark task={now.task} />
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
        </div>
      </section>
    );
  };

  const next = plan.next;
  // The next booking's leave by shows once, on its "in X min" row.
  const soonEntry = plan.agenda.find(e => e.kind === "soon");
  const soonId = soonEntry && soonEntry.kind === "soon" ? soonEntry.row.task.id : null;
  const agendaItem = (e: Extract<AgendaEntry, { kind: "item" }>) => {
    const row = e.row;
    const range = e.fixed && row.start !== null && row.end !== null ? `${clockText(row.start)}–${clockText(row.end)} · ${delta(e.minutes)}` : row.timeText;
    return (
      <li key={`item:${row.task.id}`} className={`tp-ag-slot${e.past ? " tp-ag-past" : ""}`}>
        <span className="tp-ag-time">{row.start !== null ? clockText(row.start) : ""}</span>
        <div className="tp-ag-cell">
          <section
            className={["tp-ag-card", row.green ? "tp-green" : "", row.faded ? "tp-faded" : "", row.suggested ? "tp-suggested" : ""].filter(Boolean).join(" ")}
            style={e.fixed ? { minHeight: `${agendaHeight(e.minutes)}px` } : undefined}
            aria-label={`${row.task.title}${e.slipped ? ", slipped" : e.done ? ", done" : ""}`}
          >
            <button type="button" className="tp-ag-main" onClick={() => p.onOpen(row.task)}>
              <span className="tp-ag-title">{row.task.title}</span>
              <span className="tp-meta">{range}</span>
              {signals(row, row.task.id !== soonId)}
            </button>
            <DoneCircle done={e.done} title={row.task.title} disabled={p.readOnly} onDone={() => p.onDone(row.task.id)} />
          </section>
          {e.slipped && (
            <div className="tp-extra tp-ag-extra">
              {e.again && <p className="tp-meta">Slipped again. It'll be in your Weekly Review if you leave it.</p>}
              <div className={`tp-actions${e.again ? "" : " tp-actions--three"}`}>
                {!e.again && (
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
          )}
          {!e.done && !e.slipped && row.blockedBy.length > 0 && <div className="tp-ag-extra">{blocked(row)}</div>}
        </div>
      </li>
    );
  };

  return (
    <div className="tp">
      {p.checkIn}
      {p.attentionCount > 0 && (
        <button type="button" className="tp-attention" onClick={p.onAttention}>
          <span>Needs attention ({p.attentionCount})</span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      )}

      {plan.now.length > 0 && (
        <>
          <h2 className="tp-label">Now</h2>
          {plan.now.map(nowCard)}
        </>
      )}

      <div className="tp-head">
        <h2 className="tp-label">Next thing · your choice</h2>
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
      {next && !picking ? (
        <section className={rowClass(next)} aria-label="Next thing">
          <RowMain
            row={next}
            tasks={p.tasks}
            workspace={p.workspace}
            onOpenList={p.onOpenList}
            time={next.start !== null ? next.timeText : next.when ? next.when : next.timeText}
            onOpen={() => p.onOpen(next.task)}
          />
          <div className="tp-extra">
            {next.runningNow && <p className="tp-meta">Running now, above.</p>}
            <div className="tp-actions">
              {!next.runningNow && (
                <button type="button" className="tp-btn" disabled={p.readOnly} onClick={() => p.onStart(next.task)}>
                  Start
                </button>
              )}
              <button type="button" className="tp-btn" disabled={p.readOnly} onClick={() => setPicking(true)}>
                Change
              </button>
            </div>
          </div>
          {blocked(next)}
        </section>
      ) : (
        <section className="tp-row tp-now tp-empty" aria-label="Next thing">
          {picking ? (
            <>
              {picker}
              <button type="button" className="tp-link" onClick={() => setPicking(false)}>
                Cancel
              </button>
            </>
          ) : (
            <div className="tp-next-empty">
              <span className="tp-meta">You haven't chosen one.</span>
              <button type="button" className="tp-btn" disabled={p.readOnly} onClick={() => setPicking(true)}>
                Choose…
              </button>
            </div>
          )}
        </section>
      )}

      {plan.anyTime.length > 0 && (
        <>
          <h2 className="tp-label">Any time today</h2>
          <ul className="tp-anytime">
            {plan.anyTime.map(row => (
              <li key={row.task.id} className={rowClass(row, "tp-anytime-row")}>
                <RowMain row={row} tasks={p.tasks} workspace={p.workspace} onOpenList={p.onOpenList} time="" onOpen={() => p.onOpen(row.task)} />
                <DoneCircle done={false} title={row.task.title} disabled={p.readOnly} onDone={() => p.onDone(row.task.id)} />
              </li>
            ))}
          </ul>
        </>
      )}

      <WeekStrip week={plan.week} />

      {plan.agenda.length > 0 ? (
        <ol className="tp-agenda" aria-label="Today's agenda">
          {plan.agenda.map(e => {
            if (e.kind === "item") return agendaItem(e);
            if (e.kind === "now")
              return (
                <li key="now" className="tp-ag-nowline" role="img" aria-label={`Now ${clockText(e.minute)}`}>
                  <span className="tp-ag-time">{clockText(e.minute)}</span>
                  <span className="tp-ag-redline" />
                </li>
              );
            if (e.kind === "free")
              return (
                <li key={`free:${e.start}`} className="tp-ag-slot">
                  <span className="tp-ag-time" />
                  <div className="tp-ag-cell">
                    <div className="tp-ag-free">
                      <span>Free · {delta(e.end - e.start)}</span>
                      {p.onAddAt && (
                        <button type="button" className="tp-ag-add" disabled={p.readOnly} onClick={() => p.onAddAt!(e.start)}>
                          + Add
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            return (
              <li key={`soon:${e.row.task.id}`} className="tp-ag-slot">
                <span className="tp-ag-time" />
                <div className="tp-ag-cell">
                  <p className="tp-ag-soon">
                    {e.row.task.title} {inText(e.minutesUntil)}
                    {e.row.leaveBy !== null && <span className="tp-meta"> · leave by {clockText(e.row.leaveBy)}</span>}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="tp-meta">Nothing booked today.</p>
      )}
    </div>
  );
}
