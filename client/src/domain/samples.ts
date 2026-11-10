import { emptyTaskCompass } from "./compass";
import { emptyRepeat, emptyTaskSchedule } from "./time";
import { addDays, today } from "./engine";
import type { Context, Scenario, Task, TaskState } from "./types";

interface SampleOverrides {
  title: string;
  area?: string;
  nextAction?: string;
  notes?: string;
  state?: TaskState;
  important?: boolean;
  pinned?: boolean;
  deadline?: string | null;
  startDate?: string | null;
  reviewDate?: string | null;
  deferredUntil?: string | null;
  estimate?: number;
  context?: Context;
  waitingFor?: string;
  dependencies?: string[];
  repeatDays?: number | null;
}

function task(id: string, day: string, overrides: SampleOverrides): Task {
  const stamp = `${day}T09:00:00`;
  return {
    id,
    title: overrides.title,
    area: overrides.area ?? "General",
    nextAction: overrides.nextAction ?? "",
    notes: overrides.notes ?? "",
    state: overrides.state ?? (overrides.nextAction ? "ready" : "inbox"),
    important: overrides.important ?? false,
    pinned: overrides.pinned ?? false,
    deadline: overrides.deadline ?? null,
    startDate: overrides.startDate ?? null,
    reviewDate: overrides.reviewDate ?? addDays(day, 7),
    deferredUntil: overrides.deferredUntil ?? null,
    estimate: overrides.estimate ?? 15,
    context: overrides.context ?? "anywhere",
    waitingFor: overrides.waitingFor ?? "",
    dependencies: [...(overrides.dependencies ?? [])],
    checklist: [],
    repeatDays: overrides.repeatDays ?? null,
    createdAt: stamp,
    updatedAt: stamp,
    completedAt: null,
    history: [{ at: stamp, text: "Added as sample work." }],
    purpose: "",
    role: null,
    pattern: null,
    labelSource: "unclassified",
    projectId: null,
    preparationDate: null,
    preparationSource: "suggested",
    progressEvidence: "",
    compass: emptyTaskCompass(),
    schedule: {
      ...emptyTaskSchedule(),
      repeat: overrides.repeatDays
        ? { ...emptyRepeat("after"), interval: overrides.repeatDays }
        : null,
    },
  };
}

/** The first entries read like a plausible independent tradesperson's week. */
function coreTasks(day: string): Task[] {
  return [
    task("sample-leaking-tap", day, {
      title: "Fix the leaking kitchen tap",
      area: "Home",
      nextAction: "Photograph the leaking tap and measure the washer.",
      notes: "The drip is louder overnight. Check the isolation valve first.",
      important: true,
      pinned: true,
      deadline: addDays(day, 1),
      reviewDate: day,
      estimate: 20,
      context: "home",
    }),
    task("sample-van-service", day, {
      title: "Book the van service",
      area: "Vehicles",
      nextAction: "Call Northside Motors and ask for the first weekday slot.",
      deadline: addDays(day, 4),
      reviewDate: addDays(day, 2),
      estimate: 10,
      context: "computer",
    }),
    task("sample-customer-quote", day, {
      title: "Send the Patel kitchen quote",
      area: "Business",
      nextAction: "Price the two tap options in the supplier portal.",
      important: true,
      deadline: addDays(day, 1),
      reviewDate: day,
      estimate: 25,
      context: "computer",
    }),
    task("sample-licence-renewal", day, {
      title: "Renew the waste-carrier licence",
      area: "Business",
      nextAction: "Find the renewal notice and note the licence number.",
      deadline: addDays(day, 18),
      reviewDate: addDays(day, 5),
      estimate: 15,
      context: "home",
    }),
    task("sample-website-copy", day, {
      title: "Write the trailer hire website copy",
      area: "Trailer hire",
      nextAction: "Draft the three questions customers ask most often.",
      reviewDate: addDays(day, 3),
      estimate: 30,
      context: "computer",
    }),
    task("sample-trailer-page", day, {
      title: "Publish the trailer booking page",
      area: "Trailer hire",
      nextAction: "Paste the approved copy into the booking page.",
      dependencies: ["sample-website-copy"],
      deadline: addDays(day, 9),
      reviewDate: addDays(day, 4),
      estimate: 25,
      context: "computer",
    }),
    task("sample-trailer-listing", day, {
      title: "List the box trailer for hire",
      area: "Trailer hire",
      nextAction: "Take six photos of the trailer in daylight.",
      dependencies: ["sample-trailer-page"],
      deadline: addDays(day, 11),
      reviewDate: addDays(day, 5),
      estimate: 35,
      context: "out",
    }),
    task("sample-permit-followup", day, {
      title: "Council permit confirmation",
      area: "Business",
      state: "waiting",
      waitingFor: "Mara at the council permits desk",
      nextAction: "",
      reviewDate: day,
      estimate: 5,
      context: "computer",
    }),
    task("sample-garage-shelf", day, {
      title: "Clear one shelf in the garage",
      area: "Home",
      nextAction: "Put an empty crate beside the workbench and sort one shelf.",
      important: true,
      reviewDate: day,
      estimate: 20,
      context: "home",
    }),
    task("sample-first-aid", day, {
      title: "Restock the van first-aid kit",
      area: "Vehicles",
      nextAction: "Check the expiry dates on plasters and antiseptic wipes.",
      reviewDate: addDays(day, 1),
      estimate: 10,
      context: "out",
    }),
    task("sample-bank-receipts", day, {
      title: "File last month’s fuel receipts",
      area: "Business",
      nextAction: "Put the receipts in one envelope marked with the month.",
      deferredUntil: addDays(day, 10),
      reviewDate: addDays(day, 10),
      estimate: 20,
      context: "home",
    }),
    task("sample-neighbour-ladder", day, {
      title: "Return Sam’s ladder",
      area: "Home",
      nextAction: "Text Sam to choose a time for dropping the ladder back.",
      deadline: addDays(day, 6),
      reviewDate: addDays(day, 3),
      estimate: 10,
      context: "out",
    }),
    task("sample-invoice-template", day, {
      title: "Simplify the invoice template",
      area: "Business",
      nextAction: "List the fields repeated on the last three invoices.",
      startDate: addDays(day, 14),
      reviewDate: addDays(day, 12),
      estimate: 30,
      context: "computer",
    }),
    task("sample-tool-inventory", day, {
      title: "Photograph the tool inventory",
      area: "Business",
      nextAction: "Charge the old phone used for workshop photos.",
      state: "someday",
      reviewDate: addDays(day, 30),
      estimate: 45,
      context: "home",
    }),
    task("sample-insurance-question", day, {
      title: "Ask insurer about trailer cover",
      area: "Trailer hire",
      nextAction: "Find the policy number in the renewal email.",
      reviewDate: addDays(day, 6),
      estimate: 15,
      context: "computer",
    }),
    task("sample-garden-gate", day, {
      title: "Oil the garden gate hinge",
      area: "Home",
      nextAction: "Bring the penetrating oil in from the van.",
      reviewDate: addDays(day, 8),
      estimate: 10,
      context: "home",
    }),
  ];
}

const LATER_WORK = [
  "Compare new work gloves",
  "Sort the spare cable box",
  "Price a second ladder rack",
  "Read the drainage supplier brochure",
  "Organise the workshop fasteners",
  "Update the emergency contacts card",
  "Choose labels for storage tubs",
  "Replace the van phone mount",
  "Review the old marketing photos",
  "Measure the side gate opening",
  "Ask about bulk sealant pricing",
  "Clear the office downloads folder",
];

/** Generate variation without turning large demos into 500 copies of one title. */
function laterTasks(
  day: string,
  amount: number,
  prefix = "sample-later"
): Task[] {
  return Array.from({ length: amount }, (_, index) => {
    const number = index + 1;
    const title = `${LATER_WORK[index % LATER_WORK.length]} — ${Math.floor(index / LATER_WORK.length) + 1}`;
    const cycle = index % 10;
    const shared = {
      title,
      area: ["Home", "Business", "Vehicles", "Trailer hire"][index % 4],
      nextAction: `Spend five minutes setting up the first step for item ${number}.`,
      estimate: [5, 10, 15, 25, 40][index % 5],
      context: (["home", "computer", "out", "anywhere"] as Context[])[
        index % 4
      ],
      reviewDate: addDays(day, 7 + (index % 21)),
    };

    // Seven of every ten large-dataset tasks are intentionally held later,
    // which lets the 200/500 demos test calmness rather than a wall of urgency.
    if (cycle <= 2)
      return task(`${prefix}-${number}`, day, { ...shared, state: "someday" });
    if (cycle <= 5) {
      return task(`${prefix}-${number}`, day, {
        ...shared,
        deferredUntil: addDays(day, 8 + (index % 30)),
      });
    }
    if (cycle <= 7) {
      return task(`${prefix}-${number}`, day, {
        ...shared,
        startDate: addDays(day, 9 + (index % 35)),
      });
    }
    if (cycle === 8) {
      return task(`${prefix}-${number}`, day, {
        ...shared,
        state: "waiting",
        nextAction: "",
        waitingFor: `a reply from supplier ${number}`,
        reviewDate: addDays(day, 9 + (index % 15)),
      });
    }
    return task(`${prefix}-${number}`, day, {
      ...shared,
      deadline: addDays(day, 12 + (index % 25)),
    });
  });
}

function makeDeadlineScenario(day: string, overdueOnly: boolean): Task[] {
  return Array.from({ length: 16 }, (_, index) => {
    const offset = overdueOnly ? -1 - (index % 12) : -2 + index;
    return task(
      `sample-${overdueOnly ? "overdue" : "deadline"}-${index + 1}`,
      day,
      {
        title: `${["Confirm supplier delivery", "Prepare site materials", "Reply to customer", "Check vehicle documents"][index % 4]} ${index + 1}`,
        area: index % 2 ? "Business" : "Vehicles",
        nextAction: `Open the notes and complete the first check for item ${index + 1}.`,
        important: index % 5 === 0,
        deadline: addDays(day, offset),
        reviewDate: index % 4 === 0 ? day : addDays(day, 2),
        estimate: 10 + (index % 3) * 10,
        context: (["computer", "out", "anywhere"] as Context[])[index % 3],
      }
    );
  });
}

function makeUndatedScenario(day: string): Task[] {
  const tasks = coreTasks(day).map((item, index) => ({
    ...item,
    deadline: null,
    reviewDate: index % 3 === 0 ? day : addDays(day, 4 + (index % 7)),
  }));
  return tasks;
}

function makeQuietScenario(day: string): Task[] {
  return coreTasks(day).map((item, index) => ({
    ...item,
    deadline: item.deadline ? addDays(day, 12 + index) : null,
    reviewDate:
      item.id === "sample-garage-shelf" || item.id === "sample-permit-followup"
        ? day
        : addDays(day, 8 + (index % 10)),
  }));
}

/**
 * Build deterministic demo data from dates relative to local today. The exact
 * counts make pagination, caps, and overflow states easy to test.
 */
export function makeSampleTasks(scenario: Scenario, now?: string): Task[] {
  const day = now ?? today();
  switch (scenario) {
    case "few":
      return coreTasks(day).slice(0, 5);
    case "fifty":
      return [...coreTasks(day), ...laterTasks(day, 34)];
    case "twohundred":
      return [...coreTasks(day), ...laterTasks(day, 184)];
    case "fivehundred":
      return [...coreTasks(day), ...laterTasks(day, 484)];
    case "deadlines":
      return makeDeadlineScenario(day, false);
    case "overdue":
      return makeDeadlineScenario(day, true);
    case "undated":
      return makeUndatedScenario(day);
    case "quiet":
      return makeQuietScenario(day);
  }
}
