import { createServer, type Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { registerPasteSplitRoutes, safeDrafts, type PasteSplitter } from "./pasteSplit";

let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

async function start(split: PasteSplitter) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  registerPasteSplitRoutes(app, { split, userId: async () => 46 });
  server = createServer(app);
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return (body: unknown) =>
    fetch(`http://127.0.0.1:${port}/api/capture/split`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
}

describe("Paste anything (server)", () => {
  it("sends Claude only cleaned text: account numbers gone, addresses kept", async () => {
    let sent = "";
    const post = await start(async text => {
      sent = text;
      return { items: [{ kind: "task", text: "Gutters at 14 Smith Street", date: null, amount: null, shopping_items: [] }] };
    });
    const res = await post({ text: "Gutters at 14 Smith Street\nAccount number: 1234 5678 90\nPassword: hunter2" });
    expect(res.status).toBe(200);
    expect(sent).toContain("14 Smith Street");
    expect(sent).not.toContain("1234 5678 90");
    expect(sent).not.toContain("hunter2");
    const body = await res.json();
    expect(body.items[0].text).toBe("Gutters at 14 Smith Street");
    expect(body.removed).toBeGreaterThanOrEqual(2);
  });

  it("filters Claude's drafts again and drops empty ones", () => {
    const out = safeDrafts(
      {
        items: [
          { kind: "bill", text: "AGL acct 99887766", date: "2026-02-31", amount: "1234 5678", shopping_items: [] },
          { kind: "shopping", text: "", date: null, amount: null, shopping_items: ["milk", ""] },
          { kind: "task", text: "   ", date: null, amount: null, shopping_items: [] },
        ],
      },
      0
    );
    expect(out.items).toEqual([
      { kind: "bill", text: "AGL", date: null, amount: null, shoppingItems: [] },
      { kind: "shopping", text: "milk", date: null, amount: null, shoppingItems: ["milk"] },
    ]);
    expect(out.removed).toBe(2);
  });

  it("refuses empty or over-long text", async () => {
    const post = await start(async () => ({ items: [] }));
    expect((await post({ text: "  " })).status).toBe(400);
    expect((await post({ text: "x".repeat(9000) })).status).toBe(400);
  });
});
