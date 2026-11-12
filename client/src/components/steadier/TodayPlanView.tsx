import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Info, Unlink } from "lucide-react";
import { toast } from "sonner";
import { adelaideTimestamp } from "../../../../shared/time";
import { adelaideClock } from "../../domain/time";
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

interface Props {
  workspace: Workspace;
  tasks: Task[];
  readOnly: boolean;
  attentionCount: number;
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

function RowMain({ row, tasks, time, onOpen }: { row: TodayRow; tasks: Task[]; time: string; onOpen: () => void }) {
  return (
    <button type="button" className="tp-row-main" onClick={onOpen}>
      <span className="tp-time">{time}</span>
      <span className="tp-title-wrap">
        <span className="tp-title">{row.task.title}</span>
        {(row.label || row.suggested) && (
          <span className="tp-meta">
            {[row.label, row.suggested ? "suggested · tap to confirm" : null].filter(Boolean).join(" · ")}
          </span>
        )}
      </span>
      <Chips chips={row.chips} />
      {row.brokenLink && <Unlink size={17} className="tp-broken" role="img" aria-label="Missing its Goal Outcome or Imperative link" />}
      {row.faded && <CardDotsMark task={row.task} tasks={tasks} />}
      <ChevronRight size={16} className="tp-open" aria-hidden="true" />
    </button>
  );
}

export default function TodayPlanView(p: Props) {
  const [clock, setClock] = useState(() => adelaideClock());
  const [info, setInfo] = useState(false);
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
      <div className="tp-head">
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

      <h2 className="tp-label">Now</h2>
      {now ? (
        <section id="today-now" className={rowClass(now, "tp-now")} aria-label="Now">
          <button type="button" className="tp-now-title" onClick={() => p.onOpen(now.task)}>
            <span className="tp-title">{now.task.title}</span>
            {now.brokenLink && <Unlink size={17} className="tp-broken" role="img" aria-label="Missing its Goal Outcome or Imperative link" />}
          </button>
          <p className="tp-meta">
            {now.mode === "block" && now.start !== null && now.end !== null
              ? `${clockText(now.start)} – ${clockText(now.end)}${now.likelyEnd !== null && now.likelyEnd !== now.end ? ` · likely finish ${clockText(now.likelyEnd)}` : ""}`
              : now.mode === "focus"
                ? "Focus running"
                : [plan.next === null && p.workspace.nextThing?.when ? p.workspace.nextThing.when : null, now.label].filter(Boolean).join(" · ") || "Your Next thing"}
          </p>
          <Chips chips={now.chips} />
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
            {now.mode === "next" ? (
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
        </section>
      ) : (
        <section className="tp-row tp-now tp-empty" aria-label="Now">
          <p className="tp-title">Nothing booked now.</p>
          <button type="button" className="tp-link" onClick={p.onOverview}>
            Choose a Next thing in Overview
          </button>
        </section>
      )}

      {plan.slipped.map(row => (
        <section key={row.task.id} className={rowClass(row)} aria-label={`Slipped: ${row.task.title}`}>
          <RowMain row={row} tasks={p.tasks} time={row.timeText} onOpen={() => p.onOpen(row.task)} />
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
                <RowMain row={row} tasks={p.tasks} time={row.timeText} onOpen={() => p.onOpen(row.task)} />
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
