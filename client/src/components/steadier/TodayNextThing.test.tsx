import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { adelaideClock } from "../../domain/time";
import { createTask } from "../../domain/engine";
import { createStatusMarkData } from "../../domain/statusMarkColor";
import { emptyTaskSchedule } from "../../domain/time";
import { kindContext } from "../../domain/todayStates";
import type { Task, Workspace } from "../../domain/types";
import TodayNextThing from "./TodayNextThing";
import { TaskKindContext } from "./TaskStates";

const day = adelaideClock().date;
const stamp = `${day}T09:00:00+10:30`;

function renderToday(
  tasks: Task[],
  nextThing: Workspace["nextThing"] = null,
  afterNextThing?: React.ReactNode
) {
  const workspace = {
    tasks,
    projects: [],
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    nextThing,
  } as unknown as Workspace;
  const statusMarkData = createStatusMarkData({
    projects: [],
    goals: [],
    imperatives: [],
  });
  return renderToStaticMarkup(
    <TaskKindContext.Provider
      value={{
        ctx: kindContext(workspace, null, day),
        tasks,
        statusMarkData,
        appearance: "light",
      }}
    >
      <TodayNextThing
        workspace={workspace}
        tasks={tasks}
        day={day}
        minute={10 * 60}
        readOnly={false}
        onChoose={() => true}
        onDone={() => true}
        onNotNow={() => true}
        onStillOn={() => true}
        onDrop={() => true}
        onOpenPastDue={() => undefined}
        afterNextThing={afterNextThing}
      />
    </TaskKindContext.Provider>
  );
}

function poolTask(title: string, extra: Partial<Task> = {}) {
  return createTask(
    {
      title,
      state: "ready",
      nextAction: "Open the folder",
      schedule: emptyTaskSchedule(),
      createdAt: stamp,
      updatedAt: stamp,
      ...extra,
    },
    day
  );
}

describe("Today next thing and untimed pool", () => {
  it("shows one Next thing card and title-only rows in the separate Pool card", () => {
    const first = poolTask("Call the supplier");
    const second = poolTask("File the receipt");
    const html = renderToday([first, second]);

    expect(html).toContain("Next thing");
    expect(html).toContain("No task chosen");
    expect(html).toContain("Pool");
    expect(html).toContain("Call the supplier");
    expect(html).toContain("File the receipt");
    expect(html).toContain("Choose Call the supplier as Next thing");
    expect(html).not.toContain(">Done<");
    expect(html).not.toContain("NO CLOCK TIMES");
    expect(html).not.toContain("Overdue");
    expect(html).not.toContain("Missed");
  });

  it("shows the trigger, DO action, parent task title and only the two selected-task actions", () => {
    const selected = poolTask("Book the service", {
      purpose: "Keep the home safe",
      projectId: null,
    });
    const html = renderToday([selected], {
      taskId: selected.id,
      when: "After breakfast",
      date: day,
      updatedAt: stamp,
    });

    expect(html).toContain("When");
    expect(html).toContain("After breakfast");
    expect(html).toContain("Open the folder");
    expect(html).toContain("for: Book the service");
    expect(html).not.toContain("Keep the home safe");
    expect(html).toContain("Done");
    expect(html).toContain("Not now");
    expect(html).not.toContain("Read aloud");
    expect(html).not.toContain("Task pool");
    expect(html).not.toContain("Start focus");
  });

  it("keeps pass-over counts non-red and free of overdue/missed wording in the pool", () => {
    const task = { ...poolTask("Renew the licence"), passOverCount: 3 };
    const html = renderToday([task]);

    expect(html).toContain("Renew the licence");
    expect(html).not.toContain("Overdue");
    expect(html).not.toContain("Missed");
  });

  it("keeps Next thing first, inserts the timeline, and leaves Pool after it", () => {
    const html = renderToday(
      [poolTask("Call the supplier")],
      null,
      <div>Schedule slot</div>
    );

    expect(html.indexOf("Next thing")).toBeLessThan(html.indexOf("Schedule slot"));
    expect(html.indexOf("Schedule slot")).toBeLessThan(html.indexOf(">Pool<"));
  });
});

describe("Today pool past due link", () => {
  it("shows a quiet count that opens the Past due list, and hides when none", () => {
    const yesterday = new Date(`${day}T12:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 3);
    const past = yesterday.toISOString().slice(0, 10);
    const late = poolTask("Late tidy", {
      schedule: { ...emptyTaskSchedule(), date: past },
    });
    const html = renderToday([late]);
    expect(html).toContain("Past due: 1");
    expect(html).toContain("Open the Past due list in All work");
    expect(html).not.toMatch(/overdue|red/i);
    expect(renderToday([poolTask("On time")])).not.toContain("Past due:");
  });
});
