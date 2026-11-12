import { describe, it, expect } from "vitest";
import { attention, createTask, completeTask } from "./engine";
import { parseCapture } from "./capture";
import type { MatrixWeights } from "./types";
const day = "2026-10-24";
const balanced: MatrixWeights = {
  "direction-timely": 1,
  "direction-sustained": 1,
  "support-timely": 1,
  "support-sustained": 1,
};

describe("personal life trial attention", () => {
  it("does not invent a deadline for an undated renewal", () => {
    const task = createTask(
      { title: "Renew working licence", nextAction: "Find the expiry date" },
      day
    );
    expect(task.deadline).toBeNull();
    expect(task.preparationDate).toBeNull();
    expect(attention([task], { now: day }).items).toHaveLength(1);
  });
  it("surfaces preparation as a suggestion, not an approaching real commitment", () => {
    const task = createTask(
      {
        title: "Renew registration",
        nextAction: "Find the form",
        deadline: "2026-12-01",
        preparationDate: day,
        preparationSource: "suggested",
        reviewDate: "2026-11-01",
      },
      day
    );
    const result = attention([task], { now: day });
    expect(result.commitments).toHaveLength(0);
    expect(result.items[0].reason).toContain("Suggested preparation");
  });
  it("never orders work by matrix cell (Balance, not ranking), and keeps actual commitments", () => {
    const direction = createTask(
      {
        id: "a-direction",
        title: "Learn editing",
        role: "direction",
        pattern: "sustained",
        labelSource: "confirmed",
        nextAction: "Open lesson",
        reviewDate: "2026-11-01",
      },
      day
    );
    const support = createTask(
      {
        id: "b-support",
        title: "Organise supplies",
        role: "support",
        pattern: "sustained",
        labelSource: "confirmed",
        nextAction: "Check shelf",
        reviewDate: "2026-11-01",
      },
      day
    );
    expect(
      attention([support, direction], { now: day, matrixWeights: balanced })
        .items[0].task.id
    ).toBe(direction.id);
    // Stored weights, even uneven old ones, no longer change the order.
    expect(
      attention([direction, support], {
        now: day,
        matrixWeights: { ...balanced, "support-sustained": 3 },
      }).items[0].task.id
    ).toBe(direction.id);
    const bill = createTask(
      {
        title: "Electricity payment",
        nextAction: "Open invoice",
        deadline: day,
        role: "support",
        pattern: "timely",
        labelSource: "confirmed",
        context: "computer",
      },
      day
    );
    const result = attention([bill, direction, support], {
      now: day,
      context: "home",
      minutes: 5,
      matrixWeights: { ...balanced, "direction-sustained": 3 },
    });
    expect(result.commitments[0].id).toBe(bill.id);
  });
  it("keeps explicit life tags and retains invalid date wording rather than storing an invalid date", () => {
    const task = parseCapture(
      "Make a reading corner #direction #sustained next: choose the chair",
      day
    );
    expect(task).toMatchObject({
      role: "direction",
      pattern: "sustained",
      labelSource: "confirmed",
      title: "Make a reading corner",
    });
    const invalid = parseCapture("Renew document due 2026-02-31", day);
    expect(invalid.deadline).toBeNull();
    expect(invalid.title).toContain("2026-02-31");
  });
  it("does not carry last occurrence progress evidence into a future recurrence", () => {
    const task = createTask(
      {
        title: "Check vehicle",
        nextAction: "Inspect tyres",
        repeatDays: 30,
        progressEvidence: "Tyres inspected and safe",
      },
      day
    );
    const completed = completeTask([task], task.id, day);
    expect(completed[0].progressEvidence).toContain("safe");
    expect(completed[1].progressEvidence).toBe("");
  });
});
