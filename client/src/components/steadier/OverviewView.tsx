import React, { useMemo, useState, type ReactNode } from "react";
import { ChevronRight, Info } from "lucide-react";
import { buildCalendar } from "../../domain/calendarModel";
import { freeAfterLastAnchorMinutes } from "../../domain/anchorPlanning";
import { effectiveTaskRole, projectRowIsLinked } from "../../domain/linkCheck";
import { createStatusMarkData, statusMarkColorForProject } from "../../domain/statusMarkColor";
import { adelaideClock, formatDuration, timeToMinutes } from "../../domain/time";
import { clockText } from "../../domain/todayPlan";
import type { Project, Task, Workspace } from "../../domain/types";
import TimingShapeMark from "./TimingShapeMark";

/** One row of Needs attention. Today's count is the sum of these. */
export interface AttentionItem {
  key: string;
  label: string;
  count: number;
  onOpen: () => void;
  /** When present, the row opens in place to show this (Upkeep due). */
  detail?: ReactNode;
}

export interface CountRow {
  key: string;
  label: string;
  value: string;
  onOpen: () => void;
}

interface Props {
  workspace: Workspace;
  tasks: Task[];
  attention: AttentionItem[];
  /** The existing Next thing card with its Pool (kept whole: Not now, Still on, Drop). */
  nextThing: ReactNode;
  /** Claude requests waiting for a decision; renders nothing when there are none. */
  claudeRequests: ReactNode;
  held: CountRow[];
  why: CountRow[];
  onCalendar: () => void;
  onOpenProject: (id: string) => void;
  onAllProjects: () => void;
}

export const OVERVIEW_INFO =
  "Overview is for seeing. Needs attention lists what waits for a decision; the number matches Today's. Today shows your booked time with the red now mark. Moving shows active projects. Why links to your Compass.";

function Rows({ rows }: { rows: { key: string; label: string; value: string; onOpen: () => void }[] }) {
  return (
    <div className="ov-rows">
      {rows.map(row => (
        <button key={row.key} type="button" className="ov-row" onClick={row.onOpen}>
          <span className="ov-row-label">{row.label}</span>
          <span className="ov-row-value">{row.value}</span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

export default function OverviewView(p: Props) {
  const [info, setInfo] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const clock = adelaideClock();
  const total = p.attention.reduce((sum, item) => sum + item.count, 0);

  const strip = useMemo(() => {
    const day = buildCalendar(p.tasks, p.workspace.projects, [clock.date], clock.date)[0];
    const start = timeToMinutes(p.workspace.planning.dayStart);
    const end = Math.max(start + 60, timeToMinutes(p.workspace.planning.dayEnd));
    const span = end - start;
    const blocks = (day?.timed ?? [])
      .filter(item => item.fixed && item.kind !== "deadline" && item.start !== undefined && !item.done)
      .map(item => {
        const task = p.tasks.find(t => t.id === item.taskId);
        return {
          id: item.id,
          left: Math.max(0, ((item.start! - start) / span) * 100),
          width: Math.max(1.5, ((item.minutes ?? 15) / span) * 100),
          green: !!task && effectiveTaskRole(task, p.workspace) === "direction",
          title: item.title,
        };
      })
      .filter(b => b.left < 100);
    const free = freeAfterLastAnchorMinutes(p.tasks, clock.date, p.workspace.planning, clock.minutes, clock.date);
    const freeFrom = end - free;
    return {
      blocks,
      now: Math.min(100, Math.max(0, ((clock.minutes - start) / span) * 100)),
      startText: clockText(start),
      endText: clockText(end % (24 * 60)),
      summary: `${blocks.length} booked${free > 0 ? ` · free after ${clockText(freeFrom)} for ${formatDuration(free)}` : ""}`,
    };
  }, [p.tasks, p.workspace, clock.date, clock.minutes]);

  const markData = useMemo(() => createStatusMarkData(p.workspace), [p.workspace]);
  const active = p.workspace.projects.filter(project => project.status === "active");
  const moving = active.slice(0, 3);
  // Same rule as the Projects list: green when linked to an active Imperative.
  const projectGreen = (project: Project) => projectRowIsLinked(project, p.workspace);

  return (
    <div className="ov">
      <div className="tp-head">
        <h2 className="tp-label">Needs attention ({total})</h2>
        <button
          type="button"
          className="tp-info-button"
          aria-label="What Overview shows"
          aria-expanded={info}
          onClick={() => setInfo(v => !v)}
        >
          <Info size={18} aria-hidden="true" />
        </button>
      </div>
      {info && (
        <p className="tp-info" role="note">
          {OVERVIEW_INFO}
        </p>
      )}
      {total > 0 ? (
        <div className="ov-rows">
          {p.attention
            .filter(item => item.count > 0)
            .map(item =>
              item.detail ? (
                <React.Fragment key={item.key}>
                  <button
                    type="button"
                    className="ov-row"
                    aria-expanded={openRow === item.key}
                    onClick={() => setOpenRow(openRow === item.key ? null : item.key)}
                  >
                    <span className="ov-row-label">{item.label}</span>
                    <span className="ov-row-value">{item.count}</span>
                    <ChevronRight size={16} aria-hidden="true" className={openRow === item.key ? "ov-row-open" : undefined} />
                  </button>
                  {openRow === item.key && <div className="ov-row-detail">{item.detail}</div>}
                </React.Fragment>
              ) : (
                <button key={item.key} type="button" className="ov-row" onClick={item.onOpen}>
                  <span className="ov-row-label">{item.label}</span>
                  <span className="ov-row-value">{item.count}</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              )
            )}
        </div>
      ) : (
        <p className="tp-meta ov-quiet">Nothing needs attention.</p>
      )}
      {p.claudeRequests}

      {p.nextThing}

      <h2 className="tp-label">Today</h2>
      <button type="button" className="ov-today" onClick={p.onCalendar} aria-label={`Today: ${strip.summary}. Open Calendar`}>
        <span>{strip.summary}</span>
        <span className="ov-strip" aria-hidden="true">
          {strip.blocks.map(b => (
            <span
              key={b.id}
              className={`ov-block${b.green ? " ov-block--green" : ""}`}
              style={{ left: `${b.left}%`, width: `${Math.min(b.width, 100 - b.left)}%` }}
              title={b.title}
            />
          ))}
          <span className="ov-now" style={{ left: `${strip.now}%` }} />
        </span>
        <span className="ov-strip-ends">
          <span>{strip.startText}</span>
          <span>Calendar ›</span>
          <span>{strip.endText}</span>
        </span>
      </button>

      {active.length > 0 && (
        <>
          <h2 className="tp-label">Moving</h2>
          <div className="tp-list">
            {moving.map(project => (
              <button
                key={project.id}
                type="button"
                className={`tp-row ov-project${projectGreen(project) ? " tp-green" : ""}`}
                onClick={() => p.onOpenProject(project.id)}
              >
                <span className="tp-title">{project.title}</span>
                <TimingShapeMark project={project} noGreen />
              </button>
            ))}
            <button type="button" className="tp-link ov-all" onClick={p.onAllProjects}>
              All projects ({active.length})
            </button>
          </div>
        </>
      )}

      <h2 className="tp-label">Held and waiting</h2>
      <Rows rows={p.held} />

      <h2 className="tp-label">Why</h2>
      <Rows rows={p.why} />
    </div>
  );
}
