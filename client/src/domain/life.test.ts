import { describe, expect, it } from "vitest";
import {
  identityLabel,
  makeSampleProjects,
  matrixKey,
  matrixWeight,
  suggestIdentity,
} from "./life";
import { makeSampleTasks } from "./samples";
import type { MatrixWeights, Task } from "./types";

const DAY = "2026-10-24";

function task(title: string, patch: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title,
    area: "General",
    nextAction: "Take the first small step.",
    notes: "",
    state: "ready",
    important: false,
    pinned: false,
    deadline: null,
    startDate: null,
    reviewDate: null,
    deferredUntil: null,
    estimate: 15,
    context: "anywhere",
    waitingFor: "",
    dependencies: [],
    checklist: [],
    repeatDays: null,
    createdAt: `${DAY}T12:00:00`,
    updatedAt: `${DAY}T12:00:00`,
    completedAt: null,
    history: [],
    purpose: "",
    role: null,
    pattern: null,
    labelSource: "unclassified",
    projectId: null,
    preparationDate: null,
    preparationSource: "confirmed",
    progressEvidence: "",
    ...patch,
  };
}

describe("conservative life identity suggestions", () => {
  it("suggests only clear role/pattern cues and leaves ambiguous work unclassified", () => {
    expect(
      suggestIdentity({ title: "Renew the vehicle licence" }, DAY)
    ).toMatchObject({
      role: "support",
      labelSource: "suggested",
    });
    expect(
      suggestIdentity({ title: "Develop the workshop offer" }, DAY)
    ).toMatchObject({
      role: "direction",
      labelSource: "suggested",
    });
    expect(suggestIdentity({ title: "Routine tool check" }, DAY)).toMatchObject(
      {
        pattern: "sustained",
        labelSource: "suggested",
      }
    );

    const unclear = suggestIdentity({ title: "Call Pat about the shed" }, DAY);
    expect(unclear.role).toBeUndefined();
    expect(unclear.pattern).toBeUndefined();
    expect(unclear.labelSource).toBeUndefined();

    const mixed = suggestIdentity({ title: "Develop a service project" }, DAY);
    expect(mixed.role).toBeUndefined();
  });

  it("never invents a deadline and uses an explicit deadline only for provisional timing", () => {
    const undated = suggestIdentity(
      { title: "Learn basic welding", deadline: null },
      DAY
    );
    expect(undated.deadline).toBeNull();
    expect(undated.preparationDate).toBeUndefined();

    const dated = suggestIdentity(
      {
        title: "Send a vehicle renewal",
        deadline: "2026-11-04",
        startDate: "2026-10-31",
      },
      DAY
    );
    expect(dated.deadline).toBe("2026-11-04");
    expect(dated.pattern).toBe("timely");
    expect(dated.preparationDate).toBe("2026-10-31");
    expect(dated.preparationSource).toBe("suggested");
  });

  it("preserves confirmed framing and explicit preparation/project fields", () => {
    const input = {
      title: "Renew the business licence",
      deadline: "2026-11-04",
      purpose: "Keep paperwork in order.",
      role: "direction" as const,
      pattern: "sustained" as const,
      labelSource: "confirmed" as const,
      projectId: "project-keep-legal",
      preparationDate: "2026-10-29",
      preparationSource: "confirmed" as const,
    };
    expect(suggestIdentity(input, DAY)).toMatchObject(input);
  });
});

describe("balanced life matrix", () => {
  it("starts neutral and never treats role as a value hierarchy", () => {
    const direction = task("Develop the workshop offer", {
      role: "direction",
      pattern: "timely",
      labelSource: "suggested",
    });
    const support = task("Renew the vehicle licence", {
      role: "support",
      pattern: "timely",
      labelSource: "confirmed",
    });
    const weights: MatrixWeights = {
      "direction-timely": 2,
      "direction-sustained": 1,
      "support-timely": 3,
      "support-sustained": 1,
    };

    expect(matrixKey(direction)).toBe("direction-timely");
    expect(matrixWeight(direction, undefined)).toBe(1);
    expect(matrixWeight(direction, weights)).toBe(2);
    expect(matrixWeight(support, weights)).toBe(3);
    expect(
      matrixWeight(direction, {
        ...weights,
        "direction-timely": 4,
      })
    ).toBe(1);
    expect(identityLabel(direction)).toBe("Imperative · Timely (provisional)");
    expect(matrixKey(task("Capture later"))).toBeNull();
  });
});

describe("life sample projects", () => {
  it("adds realistic project framing without changing exact task volume or mutating input", () => {
    const source = makeSampleTasks("fifty", DAY);
    const titles = source.map(item => item.title);
    const result = makeSampleProjects(source, DAY);

    expect(result.tasks).toHaveLength(50);
    expect(result.tasks.map(item => item.title)).toEqual(titles);
    expect(result.projects).toHaveLength(3);
    expect(result.projects.map(project => project.title)).toEqual([
      "Make the garage a usable workspace",
      "Keep vehicles dependable and legal",
      "Make trailer hire ready to take bookings",
    ]);
    expect(
      result.tasks.find(item => item.id === "sample-garage-shelf")?.projectId
    ).toBe("sample-project-garage-workspace");
    expect(
      result.tasks.find(item => item.id === "sample-website-copy")?.projectId
    ).toBe("sample-project-trailer-hire-ready");
    expect(
      result.tasks.filter(item => item.projectId).map(item => item.id)
    ).toEqual([
      "sample-van-service",
      "sample-website-copy",
      "sample-trailer-page",
      "sample-trailer-listing",
      "sample-garage-shelf",
      "sample-first-aid",
      "sample-tool-inventory",
    ]);
    expect(
      source.find(item => item.id === "sample-garage-shelf")?.projectId
    ).toBeNull();
  });
});
