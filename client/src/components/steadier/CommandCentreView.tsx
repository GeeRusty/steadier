import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Compass, ExternalLink } from "lucide-react";
import { adelaideDate, formatAdelaide } from "../../../../shared/time";
import type { ImperativeView } from "../../domain/compass";
import type { CalendarItem } from "../../domain/calendarModel";
import {
  COMMAND_CENTRE_REFERENCES,
  commandCentreSnapshot,
  commandCentreWorkspaceKey,
  type CommandCentreQuestion,
  type CommandCentreSnapshot,
} from "../../domain/commandCentre";
import { formatTime, minutesToTime } from "../../domain/time";
import type { Task, Workspace } from "../../domain/types";

const ANSWERS_KEY = "steadier.commandCentre.answers.v1";

interface AnswerMemory {
  key: string;
  ids: string[];
}

interface Props {
  workspace: Workspace;
  revision: number;
  readOnly: boolean;
  lastSyncedAt: string | null;
  dataSource: string;
  now?: Date;
  onConfirmImperative: (
    id: string,
    expectedUpdatedAt: string,
    expectedRevision: number
  ) => Promise<boolean> | boolean;
  onOpenTask: (
    id: string,
    expectedUpdatedAt: string,
    expectedRevision: number
  ) => Promise<boolean> | boolean;
  onCompleteTask: (
    id: string,
    expectedUpdatedAt: string,
    expectedRevision: number
  ) => Promise<boolean> | boolean;
  onOpenProject: (
    id: string,
    expectedUpdatedAt: string,
    expectedRevision: number
  ) => Promise<boolean> | boolean;
  onOpenImperative: (
    id: string,
    expectedUpdatedAt: string,
    expectedRevision: number
  ) => Promise<boolean> | boolean;
  onOpenCalendar: () => void;
  onOpenReview: () => void;
  onOpenObligation: (id: string) => void;
  onOpenPeople: () => void;
  onOpenCredentialRenewals: () => void;
}

function memoryKey(workspace: Workspace, day: string): string {
  return `${ANSWERS_KEY}:${day}:${commandCentreWorkspaceKey(workspace)}`;
}

function readMemory(key: string): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && Array.isArray(parsed.ids)
      ? parsed.ids.filter((id: unknown): id is string => typeof id === "string").slice(-100)
      : [];
  } catch {
    return [];
  }
}

function dateLabel(date: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Adelaide",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${date}T12:00:00Z`));
}

function clockLabel(item: CalendarItem): string {
  if (item.start === undefined) return "";
  return formatTime(minutesToTime(item.start));
}

function itemStatus(
  item: CalendarItem,
  workspace: Workspace,
  today: string
): string {
  if (item.done) return "Done";
  if (item.overdue) return "Past due";
  const task = item.taskId
    ? workspace.tasks.find(candidate => candidate.id === item.taskId)
    : undefined;
  if (task && adelaideDate(new Date(task.updatedAt)) === today)
    return "Moved today · still open";
  if (task) return "Still open";
  return item.label ?? "Dated item";
}

function itemTarget(
  item: CalendarItem,
  workspace: Workspace,
  callbacks: Pick<Props, "onOpenTask" | "onOpenProject" | "onOpenObligation" | "onOpenPeople" | "onOpenCredentialRenewals">
): (() => void) | null {
  if (item.taskId) {
    const task = workspace.tasks.find(candidate => candidate.id === item.taskId);
    return task
      ? () => { void callbacks.onOpenTask(task.id, task.updatedAt, 0); }
      : null;
  }
  if (item.projectId) {
    const project = workspace.projects.find(candidate => candidate.id === item.projectId);
    return project
      ? () => { void callbacks.onOpenProject(project.id, project.updatedAt, 0); }
      : null;
  }
  if (item.kind === "obligation") {
    const id = workspace.obligations?.find(obligation => item.id.startsWith(`${obligation.id}:due:`))?.id;
    return id ? () => callbacks.onOpenObligation(id) : null;
  }
  if (item.kind === "birthday") return callbacks.onOpenPeople;
  if (item.kind === "credential-renewal") return callbacks.onOpenCredentialRenewals;
  return null;
}

function ItemRow({
  item,
  workspace,
  today,
  revision,
  onOpenTask,
  onOpenProject,
  onOpenObligation,
  onOpenPeople,
  onOpenCredentialRenewals,
}: {
  item: CalendarItem;
  workspace: Workspace;
  today: string;
  revision: number;
  onOpenTask: Props["onOpenTask"];
  onOpenProject: Props["onOpenProject"];
  onOpenObligation: Props["onOpenObligation"];
  onOpenPeople: Props["onOpenPeople"];
  onOpenCredentialRenewals: Props["onOpenCredentialRenewals"];
}) {
  const click = itemTarget(item, workspace, {
    onOpenTask: (id, stamp) => onOpenTask(id, stamp, revision),
    onOpenProject: (id, stamp) => onOpenProject(id, stamp, revision),
    onOpenObligation,
    onOpenPeople,
    onOpenCredentialRenewals,
  });
  const time = clockLabel(item);
  const label = `${time ? `${time} · ` : ""}${item.label ?? item.kind}`;
  const content = (
    <>
      <span className="command-centre-item-main">
        <strong>{item.title}</strong>
        <span className="command-centre-item-meta">{label}</span>
      </span>
      <span className={`command-centre-item-state${item.done ? " is-done" : item.overdue ? " is-past-due" : ""}`}>
        {itemStatus(item, workspace, today)}
      </span>
    </>
  );
  return (
    <li className="command-centre-item-row">
      {click ? (
        <button type="button" className="command-centre-item-link" onClick={click}>
          {content}
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      ) : (
        <div className="command-centre-item-link is-static">{content}</div>
      )}
    </li>
  );
}

function ModeDescription({ snapshot }: { snapshot: CommandCentreSnapshot }) {
  if (snapshot.mode === "weekday-before-morning") {
    return (
      <p className="command-centre-rhythm" role="status">
        Morning check-in opens today at 08:00 · Australia/Adelaide. No questions yet.
      </p>
    );
  }
  if (snapshot.mode === "saturday") {
    return (
      <p className="command-centre-rhythm" role="status">
        Saturday is quiet: no question set. Weekly Reality Review: {snapshot.review.due ? "due" : "not due"}.
      </p>
    );
  }
  if (snapshot.mode === "sunday") {
    return <p className="command-centre-rhythm" role="status">Sunday has no prompts. The page still shows your dated work and what is coming up.</p>;
  }
  return (
    <p className="command-centre-rhythm" role="status">
      {snapshot.mode === "weekday-morning" ? "Morning check-in · weekdays at 08:00" : "Evening check-in · weekdays at 17:00"} · Australia/Adelaide
    </p>
  );
}

function ItemQuestion({
  question,
  revision,
  readOnly,
  onOpenTask,
  onCompleteTask,
  onOpenProject,
  onOpenImperative,
  onAnswered,
}: {
  question: CommandCentreQuestion;
  revision: number;
  readOnly: boolean;
  onOpenTask: Props["onOpenTask"];
  onCompleteTask: Props["onCompleteTask"];
  onOpenProject: Props["onOpenProject"];
  onOpenImperative: Props["onOpenImperative"];
  onAnswered: (id: string) => void;
}) {
  const [working, setWorking] = useState(false);
  const act = async (operation: () => Promise<boolean> | boolean) => {
    if (working) return;
    setWorking(true);
    try {
      if (await operation()) onAnswered(question.id);
    } finally {
      setWorking(false);
    }
  };
  const open = () => {
    if (question.itemKind === "task")
      return onOpenTask(question.itemId, question.updatedAt, revision);
    if (question.itemKind === "project")
      return onOpenProject(question.itemId, question.updatedAt, revision);
    return onOpenImperative(question.itemId, question.updatedAt, revision);
  };
  const openLabel =
    question.kind === "placement"
      ? "Choose placement"
      : question.itemKind === "project"
        ? "Review project"
        : question.itemKind === "imperative"
          ? "Open Imperative"
          : "Review task";
  return (
    <li className="command-centre-question">
      <div className="command-centre-question-copy">
        <strong>{question.question}</strong>
        <span>{question.detail}</span>
      </div>
      <div className="command-centre-question-actions">
        {question.kind === "commitment" ? (
          <>
            <button
              type="button"
              className="command-centre-action primary"
              disabled={readOnly || working}
              onClick={() => void act(() => onCompleteTask(question.itemId, question.updatedAt, revision))}
            >
              <Check size={16} aria-hidden="true" /> Mark done
            </button>
            <button
              type="button"
              className="command-centre-action secondary"
              disabled={working}
              onClick={() => void act(open)}
            >
              Change plan
            </button>
          </>
        ) : (
          <button
            type="button"
            className="command-centre-action secondary"
            disabled={working || (readOnly && question.itemKind === "task")}
            onClick={() => void act(open)}
          >
            {openLabel}
          </button>
        )}
      </div>
    </li>
  );
}

function ImperativeRow({
  view,
  revision,
  answered,
  readOnly,
  noActionLabel,
  onConfirm,
  onChange,
  onAnswered,
}: {
  view: ImperativeView;
  revision: number;
  answered: boolean;
  readOnly: boolean;
  noActionLabel: string | null;
  onConfirm: Props["onConfirmImperative"];
  onChange: Props["onOpenImperative"];
  onAnswered: (id: string) => void;
}) {
  const [working, setWorking] = useState(false);
  const answerId = `imperative:${view.imperative.id}`;
  const run = async (operation: () => Promise<boolean> | boolean) => {
    if (working || answered) return;
    setWorking(true);
    try {
      if (await operation()) onAnswered(answerId);
    } finally {
      setWorking(false);
    }
  };
  return (
    <li className={`command-centre-imperative${view.quiet ? " is-quiet" : ""}`}>
      <div className="command-centre-imperative-copy">
        <strong>{view.imperative.title}</strong>
        <span>
          {view.quiet
            ? `Quiet for ${view.quietDays} days · last movement ${view.lastMovement ?? "not recorded"}`
            : `${view.openTasks} open step${view.openTasks === 1 ? "" : "s"}${view.lastMovement ? ` · moved ${formatAdelaide(view.lastMovement, { time: false })}` : ""}`}
        </span>
      </div>
      <div className="command-centre-imperative-actions">
        {noActionLabel ? (
          <span className="command-centre-acknowledged" role="status">{noActionLabel}</span>
        ) : answered ? (
          <span className="command-centre-acknowledged" role="status">Reviewed today</span>
        ) : (
          <>
            <button
              type="button"
              className="command-centre-action primary"
              disabled={readOnly || working}
              aria-label={`Confirm ${view.imperative.title} remains active`}
              onClick={() => void run(() => onConfirm(view.imperative.id, view.imperative.updatedAt, revision))}
            >
              Confirm
            </button>
            <button
              type="button"
              className="command-centre-action secondary"
              disabled={working}
              aria-label={`Change ${view.imperative.title}`}
              onClick={() => void run(() => onChange(view.imperative.id, view.imperative.updatedAt, revision))}
            >
              Change
            </button>
          </>
        )}
      </div>
    </li>
  );
}

export default function CommandCentreView({
  workspace,
  revision,
  readOnly,
  lastSyncedAt,
  dataSource,
  now,
  onConfirmImperative,
  onOpenTask,
  onCompleteTask,
  onOpenProject,
  onOpenImperative,
  onOpenCalendar,
  onOpenReview,
  onOpenObligation,
  onOpenPeople,
  onOpenCredentialRenewals,
}: Props) {
  const [liveNow, setLiveNow] = useState(() => new Date());
  useEffect(() => {
    if (now) return;
    const timer = window.setInterval(() => setLiveNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, [now]);
  const snapshotTime = now ?? liveNow;
  const snapshot = useMemo(
    () => commandCentreSnapshot(workspace, snapshotTime),
    [workspace, snapshotTime]
  );
  const dayMemoryKey = memoryKey(workspace, snapshot.today);
  const [memory, setMemory] = useState<AnswerMemory>(() => ({
    key: dayMemoryKey,
    ids: readMemory(dayMemoryKey),
  }));
  useEffect(() => {
    if (memory.key !== dayMemoryKey)
      setMemory({ key: dayMemoryKey, ids: readMemory(dayMemoryKey) });
  }, [dayMemoryKey, memory.key]);

  const answered = memory.key === dayMemoryKey ? new Set(memory.ids) : new Set<string>();
  const questions = snapshot.questions.filter(question => !answered.has(question.id));
  const acknowledge = (id: string) => {
    setMemory(current => {
      const ids = current.key === dayMemoryKey ? current.ids : readMemory(dayMemoryKey);
      const next = [...new Set([...ids, id])].slice(-100);
      try {
        globalThis.localStorage?.setItem(dayMemoryKey, JSON.stringify({ ids: next }));
      } catch {
        /* Acknowledgements are a convenience; the live item remains unchanged. */
      }
      return { key: dayMemoryKey, ids: next };
    });
  };

  const reviewLabel = snapshot.review.due
    ? "Due"
    : snapshot.review.daysSince === null
      ? "Not due"
      : `Not due · last review ${snapshot.review.daysSince} day${snapshot.review.daysSince === 1 ? "" : "s"} ago`;
  const updates = snapshot.weekendChanges.slice(0, 3);
  const moreUpdates = Math.max(0, snapshot.weekendChanges.length - updates.length);
  const todayTaskIds = [...new Set(snapshot.todayItems.map(item => item.taskId).filter((id): id is string => Boolean(id)))];
  const todayTasks = todayTaskIds
    .map(id => workspace.tasks.find(task => task.id === id))
    .filter((task): task is Task => Boolean(task));
  const completedToday = todayTasks.filter(task => task.state === "done").length;
  const movedStillOpen = todayTasks.filter(
    task => task.state !== "done" && adelaideDate(new Date(task.updatedAt)) === snapshot.today
  ).length;
  const notMovedToday = todayTasks.filter(
    task => task.state !== "done" && adelaideDate(new Date(task.updatedAt)) !== snapshot.today
  ).length;
  const renderItem = (item: CalendarItem) => (
    <ItemRow
      key={`${item.id}:${item.date}`}
      item={item}
      workspace={workspace}
      today={snapshot.today}
      revision={revision}
      onOpenTask={onOpenTask}
      onOpenProject={onOpenProject}
      onOpenObligation={onOpenObligation}
      onOpenPeople={onOpenPeople}
      onOpenCredentialRenewals={onOpenCredentialRenewals}
    />
  );

  return (
    <section className="command-centre" aria-labelledby="command-centre-title">
      <header className="command-centre-header">
        <div>
          <p className="command-centre-eyebrow"><Compass size={15} aria-hidden="true" /> Steadier · current workspace</p>
          <h1 id="command-centre-title">Command Centre</h1>
          <p className="command-centre-intro">A short, rules-only check-in. Nothing here decides or changes anything without your tap.</p>
          <ModeDescription snapshot={snapshot} />
        </div>
      </header>

      <section className="command-centre-section" aria-labelledby="command-centre-imperatives-title">
        <div className="command-centre-section-head">
          <div>
            <h2 id="command-centre-imperatives-title">Active Imperatives</h2>
            <p>
              {snapshot.mode === "weekday-before-morning"
                ? "Read-only until the 08:00 check-in."
                : snapshot.mode === "saturday" || snapshot.mode === "sunday"
                  ? "Weekend overview only; no question set."
                  : "Confirm one is still active, or open it to make a change."} Quiet flags use Steadier’s existing 7-day rule.
            </p>
          </div>
          <span className="command-centre-count">{snapshot.activeImperatives.length}</span>
        </div>
        {snapshot.activeImperatives.length ? (
          <ul className="command-centre-imperatives">
            {snapshot.activeImperatives.map(view => (
              <ImperativeRow
                key={view.imperative.id}
                view={view}
                revision={revision}
                answered={answered.has(`imperative:${view.imperative.id}`)}
                readOnly={readOnly}
                noActionLabel={
                  snapshot.mode === "weekday-before-morning"
                    ? "Opens at 08:00"
                    : snapshot.mode === "saturday" || snapshot.mode === "sunday"
                      ? "No weekend questions"
                      : null
                }
                onConfirm={onConfirmImperative}
                onChange={onOpenImperative}
                onAnswered={acknowledge}
              />
            ))}
          </ul>
        ) : (
          <p className="command-centre-empty">No Active Imperatives yet.</p>
        )}
      </section>

      <section className="command-centre-section" aria-labelledby="command-centre-decisions-title">
        <div className="command-centre-section-head">
          <div>
            <h2 id="command-centre-decisions-title">Needs a decision</h2>
            <p>Only existing Steadier flags and dated commitments appear here. No AI interpretation.</p>
          </div>
          <span className="command-centre-count">{questions.length}</span>
        </div>
        {snapshot.mode === "saturday" || snapshot.mode === "sunday" ? (
          <div className="command-centre-quiet-day">
            <span>{snapshot.mode === "saturday" ? "Saturday · no question set" : "Sunday · no prompts"}</span>
            {snapshot.mode === "saturday" && (
              <button type="button" className="text-button" onClick={onOpenReview}>
                Weekly Reality Review {snapshot.review.due ? "is due" : "not due"}
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            )}
          </div>
        ) : snapshot.mode === "weekday-before-morning" ? (
          <div className="command-centre-quiet-day" role="status">
            Morning check-in opens at 08:00 · no questions yet.
          </div>
        ) : questions.length ? (
          <ul className="command-centre-questions">
            {questions.map(question => (
              <ItemQuestion
                key={question.id}
                question={question}
                revision={revision}
                readOnly={readOnly}
                onOpenTask={onOpenTask}
                onCompleteTask={onCompleteTask}
                onOpenProject={onOpenProject}
                onOpenImperative={onOpenImperative}
                onAnswered={acknowledge}
              />
            ))}
          </ul>
        ) : (
          <p className="command-centre-empty">Nothing here needs an answer right now.</p>
        )}
        {snapshot.mode === "weekday-morning" && updates.length > 0 && (
          <div className="command-centre-weekend">
            <h3>Weekend changes</h3>
            <ul>
              {updates.map(change => (
                <li key={change.id}>
                  <span><strong>{change.title}</strong><small>{change.status} · {formatAdelaide(change.updatedAt)}</small></span>
                  {change.itemKind === "task" ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        const task = workspace.tasks.find(item => item.id === change.itemId);
                        if (task) void onOpenTask(task.id, task.updatedAt, revision);
                      }}
                    >
                      Review <ArrowRight size={14} aria-hidden="true" />
                    </button>
                  ) : change.itemKind === "project" ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        const project = workspace.projects.find(item => item.id === change.itemId);
                        if (project) void onOpenProject(project.id, project.updatedAt, revision);
                      }}
                    >
                      Review <ArrowRight size={14} aria-hidden="true" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        const imperative = workspace.imperatives.find(item => item.id === change.itemId);
                        if (imperative) void onOpenImperative(imperative.id, imperative.updatedAt, revision);
                      }}
                    >
                      Review <ArrowRight size={14} aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {moreUpdates > 0 && <p className="small muted">{moreUpdates} more weekend change{moreUpdates === 1 ? "" : "s"} remain in Steadier.</p>}
          </div>
        )}
      </section>

      <section className="command-centre-section" aria-labelledby="command-centre-today-title">
        <div className="command-centre-section-head">
          <div>
            <h2 id="command-centre-today-title">Today</h2>
            <p>Dated Steadier commitments only. This is not a task inbox.</p>
          </div>
          <button type="button" className="command-centre-inline-link" onClick={onOpenCalendar}>
            Calendar <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
        {snapshot.todayItems.length ? (
          <ul className="command-centre-items">
            {snapshot.todayItems.map(item => renderItem(item))}
          </ul>
        ) : (
          <p className="command-centre-empty">No dated commitments today.</p>
        )}
        {snapshot.mode === "weekday-evening" && (
          <p className="command-centre-evening-summary">
            Today’s dated tasks: {completedToday} completed · {movedStillOpen} changed today and still open · {notMovedToday} still open without an update today.
          </p>
        )}
      </section>

      <section className="command-centre-section" aria-labelledby="command-centre-upcoming-title">
        <div className="command-centre-section-head">
          <div>
            <h2 id="command-centre-upcoming-title">Coming up</h2>
            <p>Calendar and Falldue items over the next three days.</p>
          </div>
          <button type="button" className="command-centre-inline-link" onClick={onOpenCalendar}>
            Open calendar <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
        {snapshot.upcomingDays.some(day => day.timed.length + day.allDay.length + day.dateMarkers.length + day.falldue.length > 0) ? (
          <div className="command-centre-upcoming-days">
            {snapshot.upcomingDays.map(day => {
              const items = [...day.timed, ...day.allDay, ...day.dateMarkers, ...day.falldue];
              return items.length ? (
                <div className="command-centre-day" key={day.date}>
                  <h3>{dateLabel(day.date)}{snapshot.fridayLookAhead && day.date === snapshot.upcomingDays.at(-1)?.date ? " · Monday look-ahead" : ""}</h3>
                  <ul className="command-centre-items">
                    {items.map(item => renderItem(item))}
                  </ul>
                </div>
              ) : null;
            })}
          </div>
        ) : (
          <p className="command-centre-empty">Nothing dated in the next few days.</p>
        )}
        {snapshot.fridayLookAhead && !snapshot.upcomingDays.some(day => day.date === snapshot.upcomingDays.at(-1)?.date && [...day.timed, ...day.allDay, ...day.dateMarkers, ...day.falldue].length > 0) && (
          <p className="command-centre-empty">Monday has no dated items yet.</p>
        )}
        {snapshot.fridayLookAhead && <p className="command-centre-footer-note">Friday check-in includes a Monday look-ahead.</p>}
      </section>

      <section className="command-centre-section" aria-labelledby="command-centre-reference-title">
        <div className="command-centre-section-head">
          <div>
            <h2 id="command-centre-reference-title">Reference</h2>
            <p>These Notion pages are structure and reading references only. Steadier remains the task source of truth; Notion Tasks are not displayed or changed.</p>
          </div>
        </div>
        <ul className="command-centre-references">
          {COMMAND_CENTRE_REFERENCES.map(reference => (
            <li key={reference.label}>
              <a href={reference.href} target="_blank" rel="noreferrer noopener">
                {reference.label} <ExternalLink size={14} aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      </section>

      <footer className="command-centre-footer">
        <dl>
          <div><dt>Data source</dt><dd>{dataSource}{revision > 0 ? ` · server revision ${revision}` : ""}</dd></div>
          <div><dt>Notion</dt><dd>Reference links only · no task reads or writes</dd></div>
          <div><dt>Last updated</dt><dd>{lastSyncedAt ? `Synced ${formatAdelaide(lastSyncedAt)}` : snapshot.lastUpdatedAt ? `Latest record ${formatAdelaide(snapshot.lastUpdatedAt)}` : "No saved record timestamp yet"}</dd></div>
          <div><dt>Weekly Reality Review</dt><dd>{reviewLabel}</dd></div>
        </dl>
        <button type="button" className="text-button" onClick={onOpenReview}>
          Open Weekly Reality Review <ArrowRight size={15} aria-hidden="true" />
        </button>
        <p>Tap a question to act. Voice drafts never answer, save, or complete anything.</p>
        <p className="command-centre-footer-note">The web page shows the check-in when opened and updates its time window while open; Android alert delivery is separate.</p>
      </footer>
    </section>
  );
}
