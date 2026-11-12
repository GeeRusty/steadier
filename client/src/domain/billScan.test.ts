import { describe, expect, it } from "vitest";
import { emptyWorkspace, parseStrictV2Workspace } from "../../../server/steadier/validation";
import { saveScannedObligations, scanFormFrom, type ScanReply } from "./billScan";
import { amountsHiddenFromAI, markObligationPaid, saveObligation } from "./obligations";
import type { Workspace } from "./types";

const STAMP = "2026-11-12T10:00:00+10:30";

function base(): Workspace {
  const w = emptyWorkspace();
  w.trial.startedAt = "2026-10-01T00:00:00.000Z";
  w.goals = [
    {
      id: "g1",
      title: "Home",
      level: "pillar",
      description: "",
      status: "active",
      parents: [],
      projects: [],
      notionUrl: null,
      history: [],
      createdAt: STAMP,
      updatedAt: STAMP,
    },
  ];
  return w;
}

const reply: ScanReply = {
  provider: "Optus",
  forWhat: "Mobile",
  amount: "$65.00",
  dueDate: "2026-11-28",
  cadence: "monthly",
  renewalDate: null,
  cancelByDate: "2026-12-15",
  kind: "bill",
  removed: 4,
  notes: [],
};

describe("Scan a bill: confirm and save", () => {
  it("fills the confirm form, offering the second date as an extra", () => {
    const form = scanFormFrom(reply, "2026-11-12");
    expect(form).toMatchObject({
      provider: "Optus",
      forWhat: "Mobile",
      kind: "bill",
      dueDate: "2026-11-28",
      cadence: "monthly",
      amount: "$65.00",
      leadTimeDays: 7,
      extra: { kind: "cancel-by", dueDate: "2026-12-15" },
      addExtra: false,
    });
    const trial = scanFormFrom({ ...reply, kind: "cancel-by", dueDate: null }, "2026-11-12");
    expect(trial).toMatchObject({ kind: "cancel-by", dueDate: "2026-12-15", leadTimeDays: 3, extra: null });
  });

  it("saves drafts only, and the extra only when ticked", () => {
    const form = scanFormFrom(reply, "2026-11-12");
    const one = saveScannedObligations(base(), form, STAMP);
    expect(one.obligations).toHaveLength(1);
    expect(one.obligations![0]).toMatchObject({ title: "Optus — Mobile", status: "draft", amountDue: "$65.00", link: null });
    expect(one.tasks).toHaveLength(0);

    const two = saveScannedObligations(base(), { ...form, addExtra: true }, STAMP);
    expect(two.obligations!.map(o => [o.kind, o.dueDate, o.status])).toEqual([
      ["bill", "2026-11-28", "draft"],
      ["cancel-by", "2026-12-15", "draft"],
    ]);
    expect(two.obligations![1].nextAction).toBe("Decide: keep or cancel Optus — Mobile");
    expect(() => saveScannedObligations(base(), { ...form, provider: " ", forWhat: "" }, STAMP)).toThrow();
  });
});

describe("Cancel by, suggestions and the AI amounts setting", () => {
  it("round-trips through strict validation; old saves still load", () => {
    const w = saveScannedObligations(base(), { ...scanFormFrom(reply, "2026-11-12"), addExtra: true }, STAMP);
    const suggested = {
      ...w,
      hideAmountsFromAI: false,
      obligations: w.obligations!.map((o, i) => (i === 1 ? { ...o, suggestedBy: "claude" as const } : o)),
    };
    const parsed = parseStrictV2Workspace(JSON.parse(JSON.stringify(suggested)));
    expect(parsed.obligations![1]).toMatchObject({ kind: "cancel-by", suggestedBy: "claude" });
    expect("suggestedBy" in parsed.obligations![0]).toBe(false);
    expect(parsed.hideAmountsFromAI).toBe(false);
    expect(amountsHiddenFromAI(parsed)).toBe(false);

    const plain = parseStrictV2Workspace(JSON.parse(JSON.stringify(base())));
    expect(plain.hideAmountsFromAI).toBeUndefined();
    expect(amountsHiddenFromAI(plain)).toBe(true);

    expect(() =>
      parseStrictV2Workspace(JSON.parse(JSON.stringify({ ...suggested, hideAmountsFromAI: "yes" })))
    ).toThrow();
  });

  it("saving a Claude suggestion yourself confirms it", () => {
    const w = saveScannedObligations(base(), scanFormFrom({ ...reply, kind: "cancel-by" }, "2026-11-12"), STAMP);
    const suggested = { ...w.obligations![0], suggestedBy: "claude" as const };
    const confirmed = saveObligation({ ...w, obligations: [suggested] }, suggested, "draft", STAMP);
    expect("suggestedBy" in confirmed.obligations![0]).toBe(false);
  });

  it("a Cancel by reminds with a preparation task, then is marked done", () => {
    const w = saveScannedObligations(base(), scanFormFrom({ ...reply, kind: "cancel-by" }, "2026-11-12"), STAMP);
    const draft = w.obligations![0];
    const active = saveObligation(w, { ...draft, cadence: "none", link: { kind: "pillar", id: "g1" } }, "active", STAMP, () => "prep-1");
    const ob = active.obligations![0];
    expect(ob).toMatchObject({ status: "active", dueDate: "2026-12-15", leadTimeDays: 3, preparationTaskId: "prep-1" });
    expect(active.tasks.find(t => t.id === "prep-1")).toBeTruthy();
    const done = markObligationPaid(active, ob.id, ob.dueDate, "2026-12-10", STAMP);
    expect(done.obligations![0].status).toBe("paid");
  });
});
