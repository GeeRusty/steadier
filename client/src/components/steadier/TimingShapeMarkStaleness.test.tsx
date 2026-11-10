import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { emptyProjectCompass } from "../../domain/compass";
import { createTask } from "../../domain/engine";
import { adelaideClock, emptyProjectSchedule, emptyTaskSchedule } from "../../domain/time";
import type { Project } from "../../domain/types";
import { createStatusMarkData } from "../../domain/statusMarkColor";
import {
  STATUS_MARK_GREY_HEX,
  statusMarkColorAfterReviewFade,
} from "../../domain/statusMarkStaleness";
import TimingShapeMark from "./TimingShapeMark";
import { TaskKindContext } from "./TaskStates";

const TODAY = adelaideClock().date;
const STAMP = `${TODAY}T09:00:00+10:30`;
const reviewDate = (() => {
  const date = new Date(`${adelaideClock().date}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 7);
  return date.toISOString().slice(0, 10);
})();

function project(purpose: string): Project {
  return {
    id: "synthetic-stage3-project",
    title: "Synthetic Stage 3 project",
    purpose,
    outcome: "",
    role: "direction",
    pattern: "timely",
    status: "active",
    milestones: [],
    progress: [],
    createdAt: STAMP,
    updatedAt: STAMP,
    schedule: emptyProjectSchedule(),
    compass: emptyProjectCompass(),
  };
}

function renderMark(mark: React.ReactNode, projectData: Project, appearance: "light" | "dark" = "light") {
  const statusMarkData = {
    ...createStatusMarkData({
      projects: [projectData],
      goals: [],
      imperatives: [],
    }),
    lastWeeklyReviewDate: reviewDate,
  };
  return renderToStaticMarkup(
    <TaskKindContext.Provider
      value={{ ctx: {} as never, tasks: [], statusMarkData, appearance }}
    >
      {mark}
    </TaskKindContext.Provider>
  );
}

describe("Stage 3 timing mark presentation", () => {
  it("fades the existing alignment hue without hiding or changing the shape", () => {
    const html = renderMark(
      <TimingShapeMark project={project("A real synthetic purpose")} />,
      project("A real synthetic purpose")
    );
    expect(html).toContain('data-shape="on-track"');
    expect(html).toContain('data-color="red"');
    expect(html).toContain('data-grey="false"');
    expect(html).toContain('data-fade-days="7"');
    expect(html).toContain(
      `--status-mark-color:${statusMarkColorAfterReviewFade("red", 7)}`
    );
    const fadedArrow = statusMarkColorAfterReviewFade("red", 7);
    expect(html).toContain(`data-arrow-color="${fadedArrow}"`);
    expect(html).toContain("alignment colour is fading");
    expect(html).toContain('data-mark-symbol="on-track"');
  });

  it("overrides alignment color to grey when a Project purpose is empty", () => {
    const emptyPurpose = project("  ");
    const html = renderMark(
      <TimingShapeMark project={emptyPurpose} />,
      emptyPurpose
    );
    expect(html).toContain('data-color="red"');
    expect(html).toContain('data-grey="true"');
    expect(html).toContain(`--status-mark-color:${STATUS_MARK_GREY_HEX}`);
    expect(html).toContain(`data-arrow-color="${STATUS_MARK_GREY_HEX}"`);
    expect(html).toContain("The Project has no purpose.");
    expect(html).toContain('data-shape="on-track"');
    const darkHtml = renderMark(
      <TimingShapeMark project={emptyPurpose} />,
      emptyPurpose,
      "dark"
    );
    expect(darkHtml).toContain('data-arrow-color="#AEB8C7"');
  });

  it("does not grey a Someday task despite quiet age and an expired review date", () => {
    const someday = createTask(
      {
        title: "Synthetic Someday item",
        state: "someday",
        reviewDate: "2026-10-01",
        createdAt: "2026-09-01T09:00:00+09:30",
        updatedAt: "2026-09-01T09:00:00+09:30",
        schedule: emptyTaskSchedule(),
      },
      "2026-11-03"
    );
    const emptyProject = project("A real synthetic purpose");
    const html = renderMark(<TimingShapeMark task={someday} />, emptyProject);
    expect(html).toContain('data-grey="false"');
    expect(html).toContain('data-color="none"');
    expect(html).not.toContain("timing-shape-grey");
  });
});
