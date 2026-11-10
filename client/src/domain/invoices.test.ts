import { describe, expect, it } from "vitest";
import { emptyProjectCompass, emptyTaskCompass } from "./compass";
import { emptyProjectSchedule, emptyTaskSchedule } from "./time";
import {
  availableInvoiceFinancialYears,
  calculateInvoiceTotals,
  canIssueInvoice,
  createInvoiceDraft,
  emptyInvoiceDraft,
  emptyInvoiceSettings,
  invoicesAnnualCsv,
  invoicesField,
  invoiceSettingsField,
  isGstConfirmationCurrent,
  isValidAbn,
  issueInvoiceDraft,
  MAX_ISSUABLE_INVOICE_NUMBER,
  reviseIssuedInvoice,
  saveInvoiceSettings,
  validateInvoiceSequence,
  voidInvoice,
} from "./invoices";
import { exportBackup, parseBackup } from "./transfer";
import type { InvoiceDraft, InvoiceRecord, Workspace } from "./types";

const stamp = "2026-10-31T10:00:00+10:30";
const syntheticAbn = "10000000000";

function workspace(): Workspace {
  return {
    version: 2,
    tasks: [],
    projects: [],
    focus: null,
    intention: null,
    matrixWeights: {
      "direction-timely": 1,
      "direction-sustained": 1,
      "support-timely": 1,
      "support-sustained": 1,
    },
    trial: { startedAt: stamp, lastExportAt: null, lastReviewAt: null },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [],
    reviews: [],
    goals: [],
  };
}

function readyWorkspace(): Workspace {
  const empty = emptyInvoiceSettings(stamp);
  return saveInvoiceSettings(
    workspace(),
    {
      ...empty,
      supplierName: "Synthetic test business",
      supplierAddress: "Example address, Adelaide SA",
      supplierAbn: syntheticAbn,
    },
    stamp
  );
}

function gstEnabledWorkspace(): Workspace {
  const supplier = {
    supplierName: "Synthetic test business",
    supplierAddress: "Example address, Adelaide SA",
    supplierAbn: syntheticAbn,
  };
  const empty = emptyInvoiceSettings(stamp);
  return saveInvoiceSettings(
    workspace(),
    {
      ...empty,
      ...supplier,
      gstMode: "exclusive",
      gstConfirmedAt: stamp,
      gstConfirmedProfile: supplier,
    },
    stamp
  );
}

function draft(overrides: Partial<InvoiceDraft> = {}): InvoiceDraft {
  return {
    ...emptyInvoiceDraft("2026-10-31"),
    customerName: "Synthetic test customer",
    customerAddress: "Example customer address",
    lines: [
      {
        id: "line-1",
        description: "Synthetic maintenance service",
        quantityMilli: 1000,
        unitPriceCents: 10000,
      },
    ],
    ...overrides,
  };
}

function createAndIssue(
  source: Workspace,
  id = "invoice-one",
  input = draft()
): Workspace {
  const created = createInvoiceDraft(source, input, id, stamp);
  return issueInvoiceDraft(created, id, stamp);
}

function firstInvoice(source: Workspace): InvoiceRecord {
  const record = source.invoices?.[0];
  if (!record) throw new Error("Expected a synthetic invoice record.");
  return record;
}

describe("invoice calculations and retained document history", () => {
  it("checks ABN checksum format without claiming external registration verification", () => {
    expect(isValidAbn(syntheticAbn)).toBe(true);
    expect(isValidAbn("12345678901")).toBe(false);
    expect(isValidAbn("12345")).toBe(false);
  });

  it("calculates GST in integer cents for exclusive, inclusive and off modes", () => {
    const lines = draft().lines;
    expect(calculateInvoiceTotals(lines, "off")).toEqual({
      subtotalCents: 10000,
      gstCents: 0,
      totalCents: 10000,
    });
    expect(calculateInvoiceTotals(lines, "exclusive")).toEqual({
      subtotalCents: 10000,
      gstCents: 1000,
      totalCents: 11000,
    });
    expect(calculateInvoiceTotals(lines, "inclusive")).toEqual({
      subtotalCents: 9091,
      gstCents: 909,
      totalCents: 10000,
    });
  });

  it("keeps GST off until explicitly configured and numbers only when a valid draft is issued", () => {
    const unconfigured = createInvoiceDraft(
      workspace(),
      draft(),
      "invoice-one",
      stamp
    );
    expect(issueInvoiceDraft(unconfigured, "invoice-one", stamp)).toBe(
      unconfigured
    );

    const created = createInvoiceDraft(
      readyWorkspace(),
      draft(),
      "invoice-one",
      stamp
    );
    expect(firstInvoice(created).status).toBe("draft");
    expect(firstInvoice(created).invoiceNumber).toBeNull();
    const issued = issueInvoiceDraft(created, "invoice-one", stamp);
    expect(firstInvoice(issued).invoiceNumber).toBe("INV-0001");
    expect(firstInvoice(issued).status).toBe("issued");
    expect(firstInvoice(issued).versions[0].gstMode).toBe("off");
    expect(issued.invoiceSettings?.nextInvoiceNumber).toBe(2);
  });

  it("issues the final supported sequence without invalidating its next counter", () => {
    const configured = readyWorkspace();
    const settings = {
      ...configured.invoiceSettings!,
      nextInvoiceNumber: MAX_ISSUABLE_INVOICE_NUMBER,
    };
    const nearCeiling = { ...configured, invoiceSettings: settings };
    const created = createInvoiceDraft(
      nearCeiling,
      draft(),
      "invoice-ceiling",
      stamp
    );
    expect(canIssueInvoice(draft(), settings)).toBe(true);

    const issued = issueInvoiceDraft(created, "invoice-ceiling", stamp);
    expect(firstInvoice(issued).invoiceNumber).toBe("INV-99999999");
    expect(issued.invoiceSettings?.nextInvoiceNumber).toBe(
      MAX_ISSUABLE_INVOICE_NUMBER + 1
    );
    expect(() => invoiceSettingsField(issued.invoiceSettings)).not.toThrow();
    expect(() =>
      validateInvoiceSequence(issued.invoiceSettings, issued.invoices)
    ).not.toThrow();

    const afterCeiling = createInvoiceDraft(
      issued,
      draft(),
      "invoice-after-ceiling",
      stamp
    );
    expect(canIssueInvoice(draft(), issued.invoiceSettings)).toBe(false);
    expect(
      issueInvoiceDraft(afterCeiling, "invoice-after-ceiling", stamp)
    ).toBe(afterCeiling);
  });

  it("requires renewed GST confirmation after supplier identity changes", () => {
    const confirmed = gstEnabledWorkspace();
    const current = confirmed.invoiceSettings;
    expect(current).toBeDefined();
    expect(isGstConfirmationCurrent(current!)).toBe(true);

    const changed = saveInvoiceSettings(
      confirmed,
      { ...current!, supplierAddress: "Changed synthetic address" },
      "2026-11-01T09:00:00+10:30"
    );
    expect(isGstConfirmationCurrent(changed.invoiceSettings!)).toBe(false);

    const created = createInvoiceDraft(
      changed,
      draft(),
      "invoice-after-profile-change",
      stamp
    );
    expect(canIssueInvoice(draft(), changed.invoiceSettings)).toBe(false);
    expect(
      issueInvoiceDraft(created, "invoice-after-profile-change", stamp)
    ).toBe(created);

    const { gstConfirmedProfile: _legacyOnly, ...legacy } =
      emptyInvoiceSettings(stamp);
    expect(invoiceSettingsField(legacy).gstConfirmedProfile).toBeNull();
  });

  it("appends a corrected copy without mutating the originally issued version", () => {
    const issued = createAndIssue(readyWorkspace());
    const original = structuredClone(firstInvoice(issued).versions[0]);
    const correctedDraft = draft({
      lines: [
        {
          id: "line-1",
          description: "Corrected synthetic service description",
          quantityMilli: 2000,
          unitPriceCents: 10000,
        },
      ],
    });
    const revised = reviseIssuedInvoice(
      issued,
      "invoice-one",
      correctedDraft,
      "Corrected quantity",
      "2026-11-01T09:00:00+10:30"
    );
    const record = firstInvoice(revised);
    expect(record.versions).toHaveLength(2);
    expect(record.versions[0]).toEqual(original);
    expect(record.versions[1].invoiceNumber).toBe("INV-0001");
    expect(record.versions[1].version).toBe(2);
    expect(record.versions[1].correctionReason).toBe("Corrected quantity");
    expect(revised.invoiceSettings?.nextInvoiceNumber).toBe(2);
  });

  it("marks a record void without deleting it or reusing its issued number", () => {
    const issued = createAndIssue(readyWorkspace());
    const voided = voidInvoice(
      issued,
      "invoice-one",
      "Synthetic duplicate record",
      "2026-11-01T09:00:00+10:30"
    );
    expect(voided.invoices).toHaveLength(1);
    expect(firstInvoice(voided).status).toBe("void");
    expect(firstInvoice(voided).invoiceNumber).toBe("INV-0001");
    expect(firstInvoice(voided).versions).toHaveLength(1);
    expect(issueInvoiceDraft(voided, "invoice-one", stamp)).toBe(voided);
    expect(voided.invoiceSettings?.nextInvoiceNumber).toBe(2);
  });

  it("round-trips private invoice settings and full version history in backups while old workspaces remain valid", () => {
    const historical = parseBackup(exportBackup(workspace()));
    expect(historical.invoiceSettings).toBeUndefined();
    expect(historical.invoices).toBeUndefined();

    const issued = createAndIssue(readyWorkspace());
    const revised = reviseIssuedInvoice(
      issued,
      "invoice-one",
      draft({ customerName: "Corrected synthetic customer" }),
      "Correct customer name",
      "2026-11-01T09:00:00+10:30"
    );
    const restored = parseBackup(exportBackup(revised));
    expect(restored.invoiceSettings).toEqual(revised.invoiceSettings);
    expect(restored.invoices).toEqual(revised.invoices);
  });

  it("rejects tampered totals, unknown fields and a next number that would reuse an invoice number", () => {
    const issued = createAndIssue(readyWorkspace());
    const record = structuredClone(firstInvoice(issued));
    record.versions[0].totalCents += 1;
    expect(() => invoicesField([record])).toThrow(/issued version/i);

    const validRecord = structuredClone(
      firstInvoice(issued)
    ) as InvoiceRecord & {
      secretNote?: string;
    };
    validRecord.secretNote = "not an accepted invoice field";
    expect(() => invoicesField([validRecord])).toThrow(/unsupported fields/i);
    expect(() =>
      validateInvoiceSequence(
        {
          ...issued.invoiceSettings!,
          nextInvoiceNumber: 1,
        },
        issued.invoices
      )
    ).toThrow(/greater than every issued/i);
  });

  it("exports only the current version by default and neutralizes spreadsheet formulas in user text", () => {
    const issued = createAndIssue(
      readyWorkspace(),
      "invoice-one",
      draft({
        lines: [
          {
            id: "line-1",
            description: '=HYPERLINK("https://example.invalid","open")',
            quantityMilli: 1000,
            unitPriceCents: 10000,
          },
        ],
      })
    );
    const revised = reviseIssuedInvoice(
      issued,
      "invoice-one",
      draft({
        customerName: "Updated synthetic buyer",
        lines: [
          {
            id: "line-1",
            description: '=HYPERLINK("https://example.invalid","open")',
            quantityMilli: 1000,
            unitPriceCents: 10000,
          },
        ],
      }),
      "Correct buyer name",
      "2026-11-01T09:00:00+10:30"
    );
    const currentCsv = invoicesAnnualCsv(revised.invoices ?? [], "2026-27");
    const allHistoryCsv = invoicesAnnualCsv(
      revised.invoices ?? [],
      "2026-27",
      true
    );
    expect(currentCsv.split("\r\n")).toHaveLength(3);
    expect(currentCsv).toContain("\"'=HYPERLINK(");
    expect(allHistoryCsv.split("\r\n")).toHaveLength(4);
    expect(allHistoryCsv).toContain("\"'=HYPERLINK(");
    expect(
      invoicesAnnualCsv(revised.invoices ?? [], "2025-26").split("\r\n")
    ).toHaveLength(2);
  });

  it("exports line amounts per row but invoice-level totals once", () => {
    const issued = createAndIssue(
      gstEnabledWorkspace(),
      "invoice-two-lines",
      draft({
        lines: [
          {
            id: "line-one",
            description: "Synthetic first line",
            quantityMilli: 1000,
            unitPriceCents: 10000,
          },
          {
            id: "line-two",
            description: "Synthetic second line",
            quantityMilli: 2000,
            unitPriceCents: 1250,
          },
        ],
      })
    );
    const csv = invoicesAnnualCsv(issued.invoices ?? [], "2026-27");
    const rows = csv
      .replace(/^\uFEFF/, "")
      .trimEnd()
      .split("\r\n");
    const cells = (row: string) => row.slice(1, -1).split('\",\"');
    const header = cells(rows[0] ?? "");
    const first = cells(rows[1] ?? "");
    const second = cells(rows[2] ?? "");
    expect(first[header.indexOf("line_total_aud")]).toBe("100.00");
    expect(second[header.indexOf("line_total_aud")]).toBe("25.00");
    expect(first[header.indexOf("subtotal_aud")]).toBe("125.00");
    expect(second[header.indexOf("subtotal_aud")]).toBe("");
    expect(first[header.indexOf("gst_aud")]).toBe("12.50");
    expect(second[header.indexOf("gst_aud")]).toBe("");
    expect(first[header.indexOf("total_aud")]).toBe("137.50");
    expect(second[header.indexOf("total_aud")]).toBe("");
  });

  it("excludes voided totals from the default CSV but retains them in an explicit history export", () => {
    const issued = createAndIssue(readyWorkspace());
    const voided = voidInvoice(
      issued,
      "invoice-one",
      "Synthetic void record",
      "2026-11-01T09:00:00+10:30"
    );
    const current = invoicesAnnualCsv(voided.invoices ?? [], "2026-27");
    const history = invoicesAnnualCsv(voided.invoices ?? [], "2026-27", true);
    expect(current).not.toContain("INV-0001");
    expect(history).toContain("INV-0001");
    expect(history).toContain('"void"');
  });

  it("keeps every saved invoice financial year selectable after the recent-year window", () => {
    const oldInvoice = createAndIssue(
      readyWorkspace(),
      "old-invoice",
      draft({ issueDate: "2001-03-15" })
    );
    const years = availableInvoiceFinancialYears(
      "2026-10-31",
      oldInvoice.invoices ?? []
    );
    expect(years[0]).toBe("2026-27");
    expect(years).toContain("2000-01");
  });
});
