import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Mic,
  Square,
  Volume2,
} from "lucide-react";
import type { Task, Workspace } from "../../domain/types";
import type { VoiceControls } from "../../hooks/useVoice";
import { completeTask } from "../../domain/engine";
import {
  activeImperatives,
  DECISION_LABEL,
  DECISION_OUTCOMES,
  imperativeViews,
  unplacedTasks,
  type DecisionOutcome,
} from "../../domain/compass";
import {
  applyReview,
  describeReview,
  emptyFloor,
  reviewStatus,
  unconfirmedCommitments,
  type ActionAnswer,
  type CapacityAnswer,
  type FloorCheck,
  type MoneyAnswer,
  type WeeklyReview,
} from "../../domain/review";
import { adelaideTimestamp } from "../../../../shared/time";
import { adelaideClock } from "../../domain/time";
import { UnplacedPanel } from "./CompassPanels";
import { mapGaps } from "../../domain/goals";
import { groupByStable, monthGroup } from "../../domain/accordionGroups";
import AccordionSection from "./AccordionSection";
import TimingShapeMark from "./TimingShapeMark";
import { IdeasShelf } from "./SetupViews";
import { bringBackIdea, ideaToTask, keepIdea, letGoIdea } from "../../domain/taskCard";

interface Props {
  workspace: Workspace;
  onMutate: (fn: (w: Workspace) => Workspace) => boolean | void;
  onOpenTask: (task: Task) => void;
  onDone: () => void;
  onOpenMap?: () => void;
  voice: VoiceControls;
  readOnly: boolean;
}

const STEPS = [
  "Start",
  "Unplaced",
  "Ideas",
  "Money",
  "Action",
  "Capacity",
  "Imperatives",
  "Map",
  "Save",
] as const;
const DRAFT_KEY = "steadier.weeklyReviewDraft.v1";

interface Draft {
  date: string;
  step: number;
  floor: FloorCheck;
  decisions: Record<string, DecisionOutcome | "">;
  notes: string;
  unplacedBefore: number;
}

function loadDraft(today: string): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return d.date === today ? d : null;
  } catch {
    return null;
  }
}

/** Map a spoken answer to one of the choices; null if unclear. */
function heard<T extends string>(text: string, map: [RegExp, T][]): T | null {
  const t = text.toLowerCase();
  for (const [re, value] of map) if (re.test(t)) return value;
  return null;
}
const MONEY_WORDS: [RegExp, MoneyAnswer][] = [
  [
    /\b(concern|worried|worry|tight|problem|not ok|not okay|short)\b/,
    "concern",
  ],
  [/\b(ok|okay|fine|good|all right|alright|covered|yes)\b/, "ok"],
];
const ACTION_WORDS: [RegExp, ActionAnswer][] = [
  [/\b(not yet|no|nope|still|later)\b/, "not-yet"],
  [/\b(drop|dropped|let it go|someday|cancel)\b/, "drop"],
  [/\b(done|yes|yep|finished|complete|did it)\b/, "done"],
];
const CAPACITY_WORDS: [RegExp, CapacityAnswer][] = [
  [/\b(low|tired|exhausted|empty|flat|drained)\b/, "low"],
  [/\b(high|strong|great|plenty|full)\b/, "high"],
  [/\b(medium|ok|okay|middle|moderate|fine|so so)\b/, "medium"],
];

export default function WeeklyReviewFlow({
  workspace,
  onMutate,
  onOpenTask,
  onDone,
  onOpenMap,
  voice,
  readOnly,
}: Props) {
  const today = adelaideClock().date;
  const status = useMemo(
    () => reviewStatus(workspace, today),
    [workspace, today]
  );
  const commitments = useMemo(
    () => unconfirmedCommitments(workspace.tasks, today),
    [workspace.tasks, today]
  );
  const views = useMemo(
    () =>
      imperativeViews(workspace, today).filter(
        v => v.imperative.status === "active"
      ),
    [workspace, today]
  );
  const [draft, setDraft] = useState<Draft>(
    () =>
      loadDraft(today) ?? {
        date: today,
        step: 0,
        floor: emptyFloor(),
        decisions: {},
        notes: "",
        unplacedBefore: unplacedTasks(workspace.tasks).length,
      }
  );
  const [message, setMessage] = useState("");
  const [listenFor, setListenFor] = useState<string | null>(null);
  const noteBase = useRef("");

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* private mode: the review still works, it just is not kept */
    }
  }, [draft]);

  const step = STEPS[draft.step];
  const go = (n: number) =>
    setDraft(d => ({ ...d, step: Math.max(0, Math.min(STEPS.length - 1, n)) }));
  const setFloor = (floor: Partial<FloorCheck>) =>
    setDraft(d => ({ ...d, floor: { ...d.floor, ...floor } }));
  const answerFor = (taskId: string) =>
    draft.floor.action.find(a => a.taskId === taskId)?.answer;
  const setAction = (task: Task, answer: ActionAnswer) =>
    setFloor({
      action: [
        ...draft.floor.action.filter(a => a.taskId !== task.id),
        { taskId: task.id, title: task.title.slice(0, 500), answer },
      ],
    });
  const nextUnanswered = commitments.find(t => !answerFor(t.id));

  // Voice answers: when listening ends, interpret the transcript for the field.
  useEffect(() => {
    if (!listenFor || voice.listening) return;
    const text = voice.transcript.trim();
    const field = listenFor;
    setListenFor(null);
    if (!text) return;
    if (field === "money") {
      const a = heard(text, MONEY_WORDS);
      a
        ? setFloor({ money: { ...draft.floor.money, answer: a } })
        : setMessage(`Heard “${text}”. Tap OK or Concern.`);
    } else if (field === "capacity") {
      const a = heard(text, CAPACITY_WORDS);
      a
        ? setFloor({ capacity: { ...draft.floor.capacity, answer: a } })
        : setMessage(`Heard “${text}”. Tap Low, Medium or High.`);
    } else if (field.startsWith("action:")) {
      const task = commitments.find(t => t.id === field.slice(7));
      const a = heard(text, ACTION_WORDS);
      if (task && a) setAction(task, a);
      else setMessage(`Heard “${text}”. Tap Done, Not yet or Drop.`);
    } else if (field.startsWith("note:")) {
      const key = field.slice(5);
      const joined =
        `${noteBase.current}${noteBase.current ? " " : ""}${text}`.slice(
          0,
          2000
        );
      if (key === "money")
        setFloor({ money: { ...draft.floor.money, note: joined } });
      if (key === "capacity")
        setFloor({ capacity: { ...draft.floor.capacity, note: joined } });
      if (key === "notes")
        setDraft(d => ({ ...d, notes: joined.slice(0, 8000) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.listening, listenFor]);

  function listen(field: string, prompt?: string, base = "") {
    if (!voice.supported || readOnly) return;
    if (voice.listening) {
      voice.stop();
      return;
    }
    noteBase.current = base;
    if (prompt && voice.speechSupported) voice.read(prompt);
    voice.clear();
    setListenFor(field);
    // Give the spoken prompt a moment so it is not transcribed as the answer.
    window.setTimeout(
      () => voice.start(),
      prompt && voice.speechSupported ? 1800 : 0
    );
  }

  function VoiceAnswer({ field, prompt }: { field: string; prompt: string }) {
    if (!voice.supported) return null;
    const on = voice.listening && listenFor === field;
    return (
      <button
        type="button"
        className={`button ${on ? "listening" : "secondary"} small-button`}
        onClick={() => listen(field, prompt)}
      >
        {on ? <Square size={14} /> : <Mic size={14} />}{" "}
        {on ? "Stop" : "Answer by voice"}
      </button>
    );
  }
  function DictateNote({ field, current }: { field: string; current: string }) {
    if (!voice.supported) return null;
    const on = voice.listening && listenFor === `note:${field}`;
    return (
      <button
        type="button"
        className="text-button"
        onClick={() => listen(`note:${field}`, undefined, current.trim())}
      >
        {on ? <Square size={14} /> : <Mic size={14} />}{" "}
        {on ? "Stop dictating" : "Dictate"}
      </button>
    );
  }
  const read = (text: string) => voice.read(text);

  function save() {
    if (readOnly) return;
    const stamp = adelaideTimestamp();
    const decisions = Object.entries(draft.decisions)
      .filter(([, outcome]) => outcome)
      .map(([id, outcome]) => ({
        kind: "imperative" as const,
        id,
        title: workspace.imperatives.find(i => i.id === id)?.title ?? id,
        outcome: outcome as DecisionOutcome,
        note: "",
      }));
    const review: WeeklyReview = {
      id: `rev-${Date.now().toString(36)}`,
      at: stamp,
      date: today,
      floor: {
        ...draft.floor,
        action: draft.floor.action.filter(a =>
          commitments.some(t => t.id === a.taskId)
        ),
      },
      decisions,
      imperatives: activeImperatives(workspace)
        .filter(i => draft.decisions[i.id] !== "retire")
        .map(i => ({ id: i.id, title: i.title })),
      quietImperatives: status.quiet,
      unplacedBefore: draft.unplacedBefore,
      unplacedAfter: unplacedTasks(workspace.tasks).length,
      notes: draft.notes.trim(),
    };
    const ok = onMutate(w =>
      applyReview(w, review, (tasks, id) => completeTask(tasks, id))
    );
    if (ok === false) {
      setMessage(
        "The review was not saved. Your answers are kept here; check sync and try again."
      );
      return;
    }
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    read(`Review saved. ${describeReview(review)}`);
    onDone();
  }

  const progress = (
    <ol className="review-steps" aria-label="Review steps">
      {STEPS.map((s, i) => (
        <li
          key={s}
          className={
            i === draft.step ? "current" : i < draft.step ? "past" : ""
          }
        >
          <button
            type="button"
            className="text-button"
            onClick={() => go(i)}
            aria-current={i === draft.step ? "step" : undefined}
          >
            {s}
          </button>
        </li>
      ))}
    </ol>
  );

  let body: React.ReactNode = null;
  if (step === "Start") {
    const last = workspace.reviews.slice().reverse();
    const lastGroups = groupByStable(last, review => monthGroup(review.at));
    const lines = [
      status.daysSince === null
        ? "This is your first Weekly Reality Review."
        : `Last review ${status.daysSince} day${status.daysSince === 1 ? "" : "s"} ago.`,
      status.commitments
        ? `${status.commitments} commitment${status.commitments === 1 ? "" : "s"} to confirm.`
        : "",
      status.quiet.length
        ? `Gone quiet: ${status.quiet.map(q => `${q.title} (${q.days} days)`).join(", ")}.`
        : "",
      status.unplaced
        ? `${status.unplaced} unplaced step${status.unplaced === 1 ? "" : "s"}.`
        : "",
    ].filter(Boolean);
    body = (
      <>
        <p className="review-lead">
          Turn this week's reality into what you will faithfully do. Floor Check
          first, then placement and Imperatives. You decide everything; Steadier
          only writes it down.
        </p>
        <ul className="review-facts">
          {lines.map(l => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <button className="text-button" onClick={() => read(lines.join(" "))}>
          <Volume2 size={15} /> Read aloud
        </button>
        {last.length > 0 && (
          <div className="accordion-group-list review-history-groups">
            {lastGroups.map((group, index) => (
              <AccordionSection
                key={group.key}
                persistenceKey={group.key}
                title={`Past reviews · ${group.label}`}
                count={group.items.length}
                collapsible={last.length > 5}
                defaultOpen={index === 0}
                className="review-history-group"
              >
            <ul className="review-history">
                  {group.items.map(r => (
                <li key={r.id} className="small">
                  {describeReview(r)}
                  {r.notes ? (
                        <span className="muted">
                          {" "}
                          “{r.notes.slice(0, 160)}”
                        </span>
                  ) : null}
                </li>
              ))}
            </ul>
              </AccordionSection>
            ))}
          </div>
        )}
      </>
    );
  } else if (step === "Money") {
    const q =
      "Floor Check, money. Is money OK this week: bills covered, nothing urgent?";
    body = (
      <>
        <h2>Money</h2>
        <p>Is money OK this week: bills covered, nothing urgent?</p>
        <div className="choice-row">
          {(["ok", "concern"] as MoneyAnswer[]).map(a => (
            <button
              key={a}
              type="button"
              className={`chip-toggle${draft.floor.money.answer === a ? " on" : ""}`}
              aria-pressed={draft.floor.money.answer === a}
              onClick={() =>
                setFloor({ money: { ...draft.floor.money, answer: a } })
              }
            >
              {a === "ok" ? "OK" : "Concern"}
            </button>
          ))}
          <VoiceAnswer field="money" prompt={q} />
        </div>
        <label className="field">
          Note (optional)
          <textarea
            rows={2}
            maxLength={2000}
            value={draft.floor.money.note}
            onChange={e =>
              setFloor({
                money: { ...draft.floor.money, note: e.target.value },
              })
            }
          />
        </label>
        <DictateNote field="money" current={draft.floor.money.note} />
      </>
    );
  } else if (step === "Action") {
    body = (
      <>
        <h2>Action</h2>
        <p>
          One plain question for each commitment whose day or deadline has
          passed, or that has been waiting over a week: is it done?
        </p>
        {commitments.length === 0 ? (
          <p className="muted">Nothing unconfirmed. Good.</p>
        ) : (
          <>
            {nextUnanswered && voice.supported && (
              <VoiceAnswer
                field={`action:${nextUnanswered.id}`}
                prompt={`Is it done: ${nextUnanswered.title}?`}
              />
            )}
            <ul className="action-checks">
              {commitments.map(t => {
                const a = answerFor(t.id);
                return (
                  <li key={t.id}>
                    <button
                      className="text-button unplaced-title"
                      onClick={() => onOpenTask(t)}
                    >
                      <TimingShapeMark task={t} /> {t.title}
                    </button>
                    <span className="small muted">
                      {t.deadline && t.deadline < today
                        ? ` deadline ${t.deadline}`
                        : t.schedule.date && t.schedule.date < today
                          ? ` planned ${t.schedule.date}`
                          : " waiting over a week"}
                    </span>
                    <div className="choice-row">
                      {(["done", "not-yet", "drop"] as ActionAnswer[]).map(
                        x => (
                          <button
                            key={x}
                            type="button"
                            className={`chip-toggle${a === x ? " on" : ""}`}
                            aria-pressed={a === x}
                            onClick={() => setAction(t, x)}
                          >
                            {x === "done"
                              ? "Yes, done"
                              : x === "not-yet"
                                ? "Not yet"
                                : "Drop to Someday"}
                          </button>
                        )
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="small muted">
              Done completes the step when you save. Drop keeps it under
              Someday; nothing is deleted.
            </p>
          </>
        )}
      </>
    );
  } else if (step === "Capacity") {
    const q =
      "Floor Check, capacity. How much do you honestly have this week: low, medium or high?";
    body = (
      <>
        <h2>Capacity</h2>
        <p>How much do you honestly have this week?</p>
        <div className="choice-row">
          {(["low", "medium", "high"] as CapacityAnswer[]).map(a => (
            <button
              key={a}
              type="button"
              className={`chip-toggle${draft.floor.capacity.answer === a ? " on" : ""}`}
              aria-pressed={draft.floor.capacity.answer === a}
              onClick={() =>
                setFloor({ capacity: { ...draft.floor.capacity, answer: a } })
              }
            >
              {a[0].toUpperCase() + a.slice(1)}
            </button>
          ))}
          <VoiceAnswer field="capacity" prompt={q} />
        </div>
        {draft.floor.capacity.answer === "low" && (
          <p className="quiet-note small">
            Low capacity is real information. Consider holding fewer
            Imperatives, or minimising one, rather than pushing harder.
          </p>
        )}
        <label className="field">
          Note (optional)
          <textarea
            rows={2}
            maxLength={2000}
            value={draft.floor.capacity.note}
            onChange={e =>
              setFloor({
                capacity: { ...draft.floor.capacity, note: e.target.value },
              })
            }
          />
        </label>
        <DictateNote field="capacity" current={draft.floor.capacity.note} />
      </>
    );
  } else if (step === "Unplaced") {
    body = (
      <UnplacedPanel
        workspace={workspace}
        onMutate={onMutate}
        onOpenTask={onOpenTask}
        onRead={read}
        readOnly={readOnly}
        limit={20}
        reviewMode
      />
    );
  } else if (step === "Ideas") {
    const ideaChange = (id: string, fn: (t: Task, stamp: string, all: Task[]) => Task) => {
      if (readOnly) return false;
      const stamp = adelaideTimestamp();
      const ok = onMutate(w => ({ ...w, tasks: w.tasks.map(t => (t.id === id ? fn(t, stamp, w.tasks) : t)) }));
      return ok !== false;
    };
    body = (
      <IdeasShelf
        tasks={workspace.tasks}
        readOnly={readOnly}
        reviewMode
        onMakeTask={id => ideaChange(id, (t, stamp, all) => ideaToTask(t, stamp, all))}
        onKeep={id => ideaChange(id, (t, stamp) => keepIdea(t, stamp))}
        onLetGo={id => ideaChange(id, (t, stamp) => letGoIdea(t, stamp))}
        onBringBack={id => ideaChange(id, (t, stamp) => bringBackIdea(t, stamp))}
      />
    );
  } else if (step === "Imperatives") {
    body = (
      <>
        <h2>Imperatives</h2>
        <p>
          Given present reality, what can you not responsibly ignore? Keep each,
          change its weight, or retire it. Add new ones on the Imperatives page
          after saving.
        </p>
        {views.length === 0 && (
          <p className="muted">No Active Imperatives yet.</p>
        )}
        <ul className="imperative-list">
          {views.map(v => (
            <li
              key={v.imperative.id}
              className={`imperative-card${v.quiet ? " quiet" : ""}`}
            >
              <h3>{v.imperative.title}</h3>
              {v.imperative.reason && (
                <p className="small">{v.imperative.reason}</p>
              )}
              <p className="small muted">
                {v.openTasks} open step{v.openTasks === 1 ? "" : "s"} · last
                movement {v.lastMovement ?? "none"}
              </p>
              {v.quiet && (
                <p className="quiet-note small">
                  Quiet for {v.quietDays} days. Still imperative? If so, what is
                  the one next step?
                </p>
              )}
              <label className="field">
                This week
                <select
                  value={draft.decisions[v.imperative.id] ?? ""}
                  onChange={e =>
                    setDraft(d => ({
                      ...d,
                      decisions: {
                        ...d.decisions,
                        [v.imperative.id]: e.target.value as
                          | DecisionOutcome
                          | "",
                      },
                    }))
                  }
                >
                  <option value="">Keep as is</option>
                  {DECISION_OUTCOMES.map(o => (
                    <option key={o} value={o}>
                      {DECISION_LABEL[o]}
                    </option>
                  ))}
                </select>
              </label>
            </li>
          ))}
        </ul>
        {views.length > 0 && (
          <button
            className="text-button"
            onClick={() =>
              read(
                views
                  .map(
                    v =>
                      `${v.imperative.title}${v.quiet ? `, quiet for ${v.quietDays} days` : ""}.`
                  )
                  .join(" ")
              )
            }
          >
            <Volume2 size={15} /> Read Imperatives aloud
          </button>
        )}
      </>
    );
  } else if (step === "Map") {
    const gaps = mapGaps(workspace, today);
    body = (
      <>
        <h2>Compass map</h2>
        <p>
          Does each Pillar still have a living outcome, and is each project
          serving something? Gaps are prompts, not failures.
        </p>
        {(workspace.goals ?? []).length === 0 ? (
          <p className="muted">
            No Pillars yet. Add them on the Compass map when you are ready; the
            review works without them.
          </p>
        ) : gaps.length === 0 ? (
          <p className="muted">
            No gaps. Every Pillar has a Value Goal, every outcome has a moving
            project.
          </p>
        ) : (
          <ul className="review-facts small">
            {gaps.slice(0, 15).map(g => (
              <li key={`${g.kind}-${g.id}`}>{g.text}</li>
            ))}
            {gaps.length > 15 && (
              <li className="muted">
                …and {gaps.length - 15} more on the map.
              </li>
            )}
          </ul>
        )}
        <div className="choice-row">
          {gaps.length > 0 && (
            <button
              className="text-button"
              onClick={() =>
                read(
                  gaps
                    .slice(0, 10)
                    .map(g => g.text)
                    .join(" ")
                )
              }
            >
              <Volume2 size={15} /> Read gaps aloud
            </button>
          )}
          {onOpenMap && (
            <button className="text-button" onClick={onOpenMap}>
              Open the Compass map (your answers are kept)
            </button>
          )}
        </div>
      </>
    );
  } else if (step === "Save") {
    const unanswered = commitments.filter(t => !answerFor(t.id)).length;
    body = (
      <>
        <h2>Notes and save</h2>
        <label className="field">
          What did you see this week? (optional)
          <textarea
            rows={4}
            maxLength={8000}
            value={draft.notes}
            onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
          />
        </label>
        <DictateNote field="notes" current={draft.notes} />
        <ul className="review-facts small">
          <li>Money: {draft.floor.money.answer ?? "not answered"}</li>
          <li>
            Action: {draft.floor.action.length} answered
            {unanswered
              ? `, ${unanswered} left unanswered (they stay as they are)`
              : ""}
          </li>
          <li>Capacity: {draft.floor.capacity.answer ?? "not answered"}</li>
          <li>
            Unplaced: {draft.unplacedBefore} at start →{" "}
            {unplacedTasks(workspace.tasks).length} now
          </li>
          <li>
            Imperative decisions:{" "}
            {Object.values(draft.decisions).filter(Boolean).length}
          </li>
        </ul>
        <button className="button primary" disabled={readOnly} onClick={save}>
          <Check size={16} /> Save review
        </button>
      </>
    );
  }

  return (
    <section className="weekly-review" aria-labelledby="weekly-review-title">
      <div className="calendar-toolbar">
        <h1 id="weekly-review-title">Weekly Reality Review</h1>
        <span className="small muted">{today}</span>
      </div>
      {progress}
      <div className="review-body">{body}</div>
      {message && (
        <p className="small muted" role="status">
          {message}
        </p>
      )}
      <div className="review-nav">
        <button
          className="button secondary"
          disabled={draft.step === 0}
          onClick={() => go(draft.step - 1)}
        >
          <ArrowLeft size={15} /> Back
        </button>
        {draft.step < STEPS.length - 1 && (
          <button className="button primary" onClick={() => go(draft.step + 1)}>
            {draft.step === 0 ? "Begin" : "Next"} <ArrowRight size={15} />
          </button>
        )}
      </div>
    </section>
  );
}
