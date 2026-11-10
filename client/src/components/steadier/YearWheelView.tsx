import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Volume2 } from "lucide-react";
import { KIND_LABEL, heldReason } from "../../domain/todayStates";
import { yearWheelEvents, type YearWheelEvent } from "../../domain/yearWheel";
import type { KindContext } from "../../domain/todayStates";
import type { Task, Workspace } from "../../domain/types";
import TimingShapeMark from "./TimingShapeMark";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

interface Props {
  workspace: Workspace;
  day: string;
  kinds: KindContext;
  onOpenTask: (task: Task) => void;
  onOpenProject: (projectId: string) => void;
  onOpenObligation: (obligationId: string) => void;
  onOpenReview: () => void;
  onRead?: (text: string) => void;
}

function dateLabel(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-AU", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }).format(date);
}

const CATEGORY_LABEL: Record<string, string> = {
  "task-planned": "Task planned",
  "preparation-task": "Preparation task planned",
  "task-deadline": "Task deadline",
  "task-start": "Task starts",
  "task-review": "Task review",
  "task-deferred": "Deferred until",
  "task-preparation-date": "Preparation date",
  "task-completed": "Completed",
  "project-deadline": "Project deadline",
  "project-review": "Project review",
  "weekly-review": "Weekly Reality Review",
  "obligation-due": "Obligation due",
  "obligation-last-due": "Last paid cycle due",
  "obligation-paid": "Marked paid",
};

function categoryLabel(category: string): string {
  if (category.startsWith("evidence-")) return "Evidence recorded";
  if (category.startsWith("progress-")) return "Project progress recorded";
  if (category.startsWith("milestone-")) return "Project milestone";
  return CATEGORY_LABEL[category] ?? category;
}

function sourceAction(
  event: YearWheelEvent,
  props: Props
): { label: string; run: () => void } {
  if (event.source === "task") {
    const task = props.workspace.tasks.find(item => item.id === event.sourceId);
    return {
      label: "Open Task",
      run: () => task && props.onOpenTask(task),
    };
  }
  if (event.source === "project") {
    return {
      label: "Open Project",
      run: () => props.onOpenProject(event.sourceId),
    };
  }
  if (event.source === "obligation") {
    return {
      label: "Open obligation",
      run: () => props.onOpenObligation(event.sourceId),
    };
  }
  return { label: "Open reviews", run: props.onOpenReview };
}

export default function YearWheelView(props: Props) {
  const initialYear = Number(props.day.slice(0, 4));
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(
    year === initialYear ? Number(props.day.slice(5, 7)) - 1 : 0
  );
  useEffect(() => {
    setYear(initialYear);
    setMonth(Number(props.day.slice(5, 7)) - 1);
  }, [initialYear, props.day]);
  const events = useMemo(
    () => yearWheelEvents(props.workspace, year, props.kinds),
    [props.workspace, props.kinds, year]
  );
  const monthlyEvents = events.filter(
    event => Number(event.date.slice(5, 7)) - 1 === month
  );
  const counts = Array.from(
    { length: 12 },
    (_, index) =>
      events.filter(event => Number(event.date.slice(5, 7)) - 1 === index)
        .length
  );
  const readMonth = () => {
    const summary = monthlyEvents
      .slice(0, 35)
      .map(
        event =>
          `${dateLabel(event.date)}. ${event.label}. ${categoryLabel(event.category)}.`
      )
      .join(" ");
    props.onRead?.(
      `${MONTHS[month]} ${year}. ${monthlyEvents.length} saved date${monthlyEvents.length === 1 ? "" : "s"}. ${summary || "No dates recorded."}`
    );
  };
  return (
    <main className="year-wheel-view page-view">
      <header className="page-heading">
        <div>
          <div className="eyebrow">SAVED DATES · READ ONLY</div>
          <h1>Year Wheel</h1>
          <p>
            A year at a glance from dates already saved in Tasks, Projects,
            Obligations, reviews and evidence. Repeats are not projected
            forward; planned dates, preparation dates and due dates remain
            distinct.
          </p>
        </div>
        <div className="year-wheel-year-control" aria-label="Choose year">
          <button
            className="icon-button"
            type="button"
            aria-label="Previous year"
            onClick={() => {
              setYear(value => Math.max(1900, value - 1));
              setMonth(0);
            }}
            disabled={year <= 1900}
          >
            <ArrowLeft size={17} aria-hidden />
          </button>
          <strong>{year}</strong>
          <button
            className="icon-button"
            type="button"
            aria-label="Next year"
            onClick={() => {
              setYear(value => Math.min(2200, value + 1));
              setMonth(0);
            }}
            disabled={year >= 2200}
          >
            <ArrowRight size={17} aria-hidden />
          </button>
        </div>
      </header>
      <nav className="year-wheel-months" aria-label={`${year} months`}>
        {MONTHS.map((name, index) => (
          <button
            type="button"
            className={month === index ? "selected" : ""}
            aria-pressed={month === index}
            key={name}
            onClick={() => setMonth(index)}
          >
            <span>{name.slice(0, 3)}</span>
            <span className="month-event-count">{counts[index]}</span>
          </button>
        ))}
      </nav>
      <div className="year-wheel-month-heading">
        <div>
          <div className="eyebrow">{year}</div>
          <h2>{MONTHS[month]}</h2>
          <p className="small muted">
            {monthlyEvents.length} saved date
            {monthlyEvents.length === 1 ? "" : "s"}
          </p>
        </div>
        {props.onRead && (
          <button
            className="button secondary"
            type="button"
            onClick={readMonth}
          >
            <Volume2 size={16} aria-hidden /> Read month aloud
          </button>
        )}
      </div>
      {!monthlyEvents.length ? (
        <div className="empty-state">
          <CalendarDays size={24} aria-hidden />
          <h3>No saved dates this month</h3>
          <p>No repeat dates or commitments have been invented.</p>
        </div>
      ) : (
        <ol className="year-wheel-events">
          {monthlyEvents.map(event => {
            const action = sourceAction(event, props);
            const task =
              event.source === "task"
                ? props.workspace.tasks.find(item => item.id === event.sourceId)
                : null;
            return (
              <li className="year-wheel-event" key={event.id}>
                <time dateTime={event.date}>{dateLabel(event.date)}</time>
                <div className="year-wheel-event-copy">
                  <strong>
                    {task && <TimingShapeMark task={task} />} {event.label}
                  </strong>
                  <span className="small muted">
                    {categoryLabel(event.category)}
                    {event.detail ? ` · ${event.detail}` : ""}
                  </span>
                  {task && (
                    <span className="year-wheel-task-status">
                      {event.taskDone ? (
                        <span className="small">Completed</span>
                      ) : event.taskKind ? (
                        <span className={`task-kind ${event.taskKind}`}>
                          {KIND_LABEL[event.taskKind]}
                        </span>
                      ) : null}
                      {event.taskKind === "held" &&
                        heldReason(task, props.workspace.tasks) && (
                          <span className="small muted">
                            {heldReason(task, props.workspace.tasks)}
                          </span>
                        )}
                    </span>
                  )}
                </div>
                <button
                  className="text-button year-wheel-open"
                  type="button"
                  onClick={action.run}
                  disabled={event.source === "task" && !task}
                >
                  {action.label}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
