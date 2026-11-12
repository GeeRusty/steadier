import { createServer, type Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { registerBillScanRoutes, safeScanResult, type BillFields, type FieldExtractor, type OcrReader } from "./billScan";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString("base64");

const BILL_TEXT = `AGL Energy
Electricity
Account number: 1234 5678 90
Biller code: 23796 Ref: 4455 6677 8899
14 Smith Street
ADELAIDE SA 5000
Amount due $412.50
Due date 28/11/2026`;

let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

async function start(ocr: OcrReader, extract: FieldExtractor) {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  registerBillScanRoutes(app, { ocr, extract, userId: async () => 46, now: () => new Date("2026-11-12T01:00:00Z") });
  server = createServer(app);
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return (body: unknown) =>
    fetch(`http://127.0.0.1:${port}/api/obligations/scan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
}

const fields: BillFields = {
  provider: "AGL Energy",
  for_what: "Electricity",
  amount: "412.50",
  due_date: "2026-11-28",
  how_often: "quarterly",
  renewal_date: null,
  cancel_by_date: null,
  kind: "bill",
};

describe("Scan a bill", () => {
  it("sends Claude only the cleaned text, never the photo or account details", async () => {
    let sentToClaude = "";
    let ocrSaw: Buffer | null = null;
    const post = await start(
      async image => {
        ocrSaw = Buffer.from(image);
        return BILL_TEXT;
      },
      async text => {
        sentToClaude = text;
        return fields;
      }
    );
    const res = await post({ image: `data:image/jpeg;base64,${JPEG}` });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(ocrSaw!.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    for (const secret of ["1234 5678 90", "23796", "4455 6677 8899", "Smith Street", "ADELAIDE SA 5000"]) {
      expect(sentToClaude).not.toContain(secret);
    }
    expect(sentToClaude).toContain("$412.50");
    expect(sentToClaude).not.toContain(JPEG);
    const body = await res.json();
    expect(body).toMatchObject({
      provider: "AGL Energy",
      forWhat: "Electricity",
      amount: "$412.50",
      dueDate: "2026-11-28",
      cadence: "quarterly",
      kind: "bill",
    });
    expect(body.removed).toBeGreaterThanOrEqual(4);
  });

  it("filters Claude's answer again: no account numbers in any field", () => {
    const result = safeScanResult(
      { ...fields, provider: "AGL acct 99887766", for_what: "Power 062-000", amount: "1234 5678", due_date: "2026-02-31", how_often: "fortnightly" },
      0
    );
    expect(JSON.stringify(result)).not.toMatch(/99887766|062-000|1234 5678/);
    expect(result.provider).toBe("AGL");
    expect(result.amount).toBeNull();
    expect(result.dueDate).toBeNull();
    expect(result.cadence).toBe("none");
    expect(result.notes.join(" ")).toContain("fortnightly");
    expect(result.removed).toBe(3);
  });

  it("refuses anything that isn't a photo, and blank photos", async () => {
    const post = await start(async () => "   ", async () => fields);
    expect((await post({ image: Buffer.from("hello world").toString("base64") })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ image: JPEG })).status).toBe(422);
  });

  it("an unreadable photo or a failed AI call says so plainly", async () => {
    const post = await start(
      async () => {
        throw new Error("boom");
      },
      async () => fields
    );
    const res = await post({ image: JPEG });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/couldn't be read/);
  });
});
