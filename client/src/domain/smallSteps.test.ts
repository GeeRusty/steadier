import { describe, expect, it } from "vitest";
import { removeSmallStep } from "./smallSteps";

describe("removeSmallStep", () => {
  it("removes only the selected item and preserves every remaining checked state", () => {
    const steps = [
      { id: "step-a", text: "Measure", done: true },
      { id: "step-b", text: "Call the supplier", done: false },
      { id: "step-c", text: "File the receipt", done: true },
    ];

    expect(removeSmallStep(steps, "step-b")).toEqual([steps[0], steps[2]]);
  });

  it("leaves the list unchanged when the selected ID no longer exists", () => {
    const steps = [{ id: "step-a", text: "Measure", done: true }];

    expect(removeSmallStep(steps, "missing")).toEqual(steps);
  });
});
