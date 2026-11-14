import { describe, expect, it } from "vitest";
import { emptyWorkspace, parseStrictV2Workspace } from "../../../server/steadier/validation";
import { createTask } from "./engine";
import { applyPasteDrafts, draftWhen, looksLikeSeveralThings, similarOpenTask, type PasteDraft } from "./pasteSplit";

const TODAY = "2026-11-13";
const STAMP = "2026-11-13T10:00:00+10:30";
const d = (kind: PasteDraft["kind"], text: string, extra: Partial<PasteDraft> = {}): PasteDraft => ({
  kind,
  text,
  date: null,
  amount: null,
  shoppingItems: [],
  ...extra,
});

describe("Paste anything", () => {
  it("offers Split only for several lines or long text", () => {
    expect(looksLikeSeveralThings("Call Sam tomorrow 3pm")).toBe(false);
    expect(looksLikeSeveralThings("milk\nbread")).toBe(true);
    expect(looksLikeSeveralThings("x".repeat(200))).toBe(true);
  });

  it("saves each ticked draft as its normal kind of record, and it all still validates", () => {
    const w = emptyWorkspace();
    w.trial.startedAt = "2026-10-01T00:00:00.000Z";
    const next = applyPasteDrafts(
      w,
      [
        d("task", "Quote the Patel fence by Monday"),
        d("idea", "Trailer hire on weekends"),
        d("bill", "Invoice — Hendersons", { date: "2026-11-28", amount: "$480.00" }),
        d("cancel-by", "Netflix trial", { date: "2026-12-01" }),
        d("note", "Andy prefers mornings"),
        d("shopping", "milk, bread", { shoppingItems: ["milk", "bread"] }),
      ],
      TODAY,
      9 * 60,
      STAMP
    );
    const task = next.tasks.find(t => t.title.startsWith("Quote the Patel fence"))!;
    expect(task.deadline).toBe("2026-11-16");
    expect(task.history[0].text).toBe("Captured from pasted text.");
    expect(next.tasks.find(t => t.title === "Trailer hire on weekends")?.state).toBe("someday");
    expect(next.obligations!.map(o => [o.kind, o.dueDate, o.status, o.amountDue])).toEqual([
      ["bill", "2026-11-28", "draft", "$480.00"],
      ["cancel-by", "2026-12-01", "draft", null],
    ]);
    expect(next.dailyLog![0].text).toBe("Andy prefers mornings");
    expect(next.lists!.templates[0].title).toBe("Shopping");
    expect(next.lists!.runs[0].extras.map(i => i.text)).toEqual(["milk", "bread"]);
    expect(() => parseStrictV2Workspace(JSON.parse(JSON.stringify(next)))).not.toThrow();
  });

  it("shows the date it will get, and a quiet hint for a similar open task", () => {
    expect(draftWhen(d("task", "Quote the Patel fence by Friday"), TODAY, 9 * 60)).toMatch(/^due /);
    const existing = createTask({ title: "Gutter clean — Henderson job" });
    expect(similarOpenTask("Gutters at Hendersons gutter clean", [existing])?.id).toBe(existing.id);
    expect(similarOpenTask("Buy milk", [existing])).toBeNull();
  });
});
