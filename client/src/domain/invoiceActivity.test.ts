import { describe, expect, it } from "vitest";
import {
  invoiceDeliveryState,
  invoicePaymentActivityAnnualCsv,
  invoicePaymentReversibleCents,
  invoicePaymentState,
  invoicePaymentSummary,
  recordInvoiceDeliveryAttempt,
  recordInvoicePayment,
  reverseInvoicePayment,
} from "./invoiceActivity";
import {
  availableInvoiceFinancialYears,
  createInvoiceDraft,
  emptyInvoiceDraft,
  emptyInvoiceSettings,
  invoicesAnnualCsv,
  invoicesField,
  issueInvoiceDraft,
  reviseIssuedInvoice,
  saveInvoiceSettings,
  voidInvoice,
} from "./invoices";
import { exportBackup, parseBackup } from "./transfer";
import type { InvoiceDraft, InvoiceRecord, Workspace } from "./types";

const createdAt = "2026-06-30T10:00:00+09:30";
const issuedOn = "2026-06-30";
const activityOn = "2026-07-02";

function emptyWorkspace(): Workspace {
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
    trial: { startedAt: createdAt, lastExportAt: null, lastReviewAt: null },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [],
    reviews: [],
    goals: [],
  };
}

function readyWorkspace(): Workspace {
  const settings = emptyInvoiceSettings(createdAt);
  return saveInvoiceSettings(
    emptyWorkspace(),
    {
      ...settings,
      supplierName: "Synthetic test supplier",
      supplierAddress: "Example address, Adelaide SA",
      supplierAbn: "10000000000",
    },
    createdAt
  );
}

function draft(overrides: Partial<InvoiceDraft> = {}): InvoiceDraft {
  return {
    ...emptyInvoiceDraft(issuedOn),
    issueDate: issuedOn,
    dueDate: "2026-07-01",
    customerName: "Synthetic test customer",
    jobReference: "JOB-OLD",
    lines: [
      {
        id: "line-one",
        description: "Synthetic work",
        quantityMilli: 1000,
        unitPriceCents: 10000,
      },
    ],
    ...overrides,
  };
}

function issue(input = draft()): Workspace {
  const created = createInvoiceDraft(
    readyWorkspace(),
    input,
    "invoice-one",
    createdAt
  );
  return issueInvoiceDraft(created, "invoice-one", createdAt);
}

function invoice(workspace: Workspace): InvoiceRecord {
  const record = workspace.invoices?.[0];
  if (!record) throw new Error("Expected a synthetic invoice.");
  return record;
}

describe("manual invoice delivery and payment activity", () => {
  it("derives unpaid, part-paid, paid and overdue from dated receipts", () => {
    const issued = issue();
    expect(invoiceDeliveryState(invoice(issued))).toBe("not-sent");
    expect(invoicePaymentState(invoice(issued), activityOn)).toBe("overdue");

    const partial = recordInvoicePayment(
      issued,
      "invoice-one",
      { date: activityOn, amountCents: 4000, note: "Synthetic deposit" },
      "payment-one",
      "2026-07-02T11:00:00+09:30",
      activityOn
    );
    expect(invoicePaymentState(invoice(partial), activityOn)).toBe("overdue");
    expect(invoicePaymentSummary(invoice(partial))).toMatchObject({
      grossReceivedCents: 4000,
      receivedCents: 4000,
      reversedCents: 0,
      netReceivedCents: 4000,
      balanceDueCents: 6000,
      creditDueCents: 0,
    });

    const finalReceipt = recordInvoicePayment(
      partial,
      "invoice-one",
      { date: activityOn, amountCents: 6000, note: "Synthetic final receipt" },
      "payment-two",
      "2026-07-02T12:00:00+09:30",
      activityOn
    );
    expect(invoicePaymentState(invoice(finalReceipt), activityOn)).toBe("paid");
    expect(finalReceipt.tasks).toEqual(issued.tasks);
  });

  it("rejects overpayment, pre-issue activity, future dates and excessive reversal", () => {
    const issued = issue();
    expect(
      recordInvoicePayment(
        issued,
        "invoice-one",
        { date: activityOn, amountCents: 10001, note: "Synthetic" },
        "payment-over",
        "2026-07-02T11:00:00+09:30",
        activityOn
      )
    ).toBe(issued);
    expect(
      recordInvoicePayment(
        issued,
        "invoice-one",
        { date: "2026-06-29", amountCents: 1000, note: "Synthetic" },
        "payment-early",
        "2026-07-02T11:00:00+09:30",
        activityOn
      )
    ).toBe(issued);
    expect(
      recordInvoiceDeliveryAttempt(
        issued,
        "invoice-one",
        { date: "2026-07-03", result: "sent", note: "Synthetic" },
        "delivery-future",
        "2026-07-02T11:00:00+09:30",
        activityOn
      )
    ).toBe(issued);

    const paid = recordInvoicePayment(
      issued,
      "invoice-one",
      { date: activityOn, amountCents: 2000, note: "Synthetic" },
      "payment-one",
      "2026-07-02T11:00:00+09:30",
      activityOn
    );
    expect(
      reverseInvoicePayment(
        paid,
        "invoice-one",
        "payment-one",
        { date: "2026-07-03", amountCents: 2001, note: "Synthetic reason" },
        "reversal-over",
        "2026-07-03T11:00:00+09:30",
        "2026-07-03"
      )
    ).toBe(paid);
  });

  it("appends manual delivery attempts and uses the latest event for the current version", () => {
    const issued = issue();
    const sent = recordInvoiceDeliveryAttempt(
      issued,
      "invoice-one",
      { date: activityOn, result: "sent", note: "Synthetic manual send" },
      "delivery-one",
      "2026-07-02T11:00:00+09:30",
      activityOn
    );
    expect(invoiceDeliveryState(invoice(sent))).toBe("sent");
    const failedResend = recordInvoiceDeliveryAttempt(
      sent,
      "invoice-one",
      { date: activityOn, result: "failed", note: "Synthetic retry failed" },
      "delivery-two",
      "2026-07-02T12:00:00+09:30",
      activityOn
    );
    expect(invoiceDeliveryState(invoice(failedResend))).toBe("failed");
    expect(invoice(failedResend).deliveryEvents).toHaveLength(2);

    const corrected = reviseIssuedInvoice(
      failedResend,
      "invoice-one",
      draft({ jobReference: "JOB-NEW" }),
      "Synthetic correction",
      "2026-07-03T11:00:00+09:30"
    );
    expect(invoiceDeliveryState(invoice(corrected))).toBe("not-sent");
    expect(
      invoice(corrected).deliveryEvents?.map(event => event.version)
    ).toEqual([1, 1]);
  });

  it("preserves receipt entries and requires dated, reasoned reversals", () => {
    const issued = issue();
    const paid = recordInvoicePayment(
      issued,
      "invoice-one",
      { date: activityOn, amountCents: 7000, note: "Synthetic receipt" },
      "payment-one",
      "2026-07-02T11:00:00+09:30",
      activityOn
    );
    const reversed = reverseInvoicePayment(
      paid,
      "invoice-one",
      "payment-one",
      {
        date: "2026-07-03",
        amountCents: 2000,
        note: "Synthetic correction reason",
      },
      "reversal-one",
      "2026-07-03T11:00:00+09:30",
      "2026-07-03"
    );
    expect(invoice(reversed).paymentEvents).toHaveLength(2);
    expect(invoice(reversed).paymentEvents?.[0].kind).toBe("payment");
    expect(invoice(reversed).paymentEvents?.[1]).toMatchObject({
      kind: "reversal",
      reversalOf: "payment-one",
      amountCents: 2000,
      version: 1,
    });
    expect(
      invoicePaymentReversibleCents(invoice(reversed), "payment-one")
    ).toBe(5000);
    expect(invoicePaymentSummary(invoice(reversed))).toMatchObject({
      grossReceivedCents: 7000,
      reversedCents: 2000,
      receivedCents: 5000,
      netReceivedCents: 5000,
      balanceDueCents: 5000,
    });
    expect(
      reverseInvoicePayment(
        reversed,
        "invoice-one",
        "payment-one",
        { date: "2026-07-04", amountCents: 500, note: "  " },
        "reversal-no-reason",
        "2026-07-04T11:00:00+09:30",
        "2026-07-04"
      )
    ).toBe(reversed);
  });

  it("shows credit due after a correction lowers a paid invoice total and blocks void with money outstanding", () => {
    const paid = recordInvoicePayment(
      issue(),
      "invoice-one",
      { date: activityOn, amountCents: 10000, note: "Synthetic paid" },
      "payment-one",
      "2026-07-02T11:00:00+09:30",
      activityOn
    );
    const corrected = reviseIssuedInvoice(
      paid,
      "invoice-one",
      draft({
        dueDate: null,
        lines: [
          {
            id: "line-one",
            description: "Synthetic corrected work",
            quantityMilli: 1000,
            unitPriceCents: 8000,
          },
        ],
      }),
      "Synthetic downward correction",
      "2026-07-03T11:00:00+09:30"
    );
    expect(invoicePaymentState(invoice(corrected), "2026-07-03")).toBe(
      "credit-due"
    );
    expect(invoicePaymentSummary(invoice(corrected))).toMatchObject({
      grossReceivedCents: 10000,
      reversedCents: 0,
      receivedCents: 10000,
      netReceivedCents: 10000,
      balanceDueCents: 0,
      creditDueCents: 2000,
    });
    expect(
      voidInvoice(
        corrected,
        "invoice-one",
        "Synthetic void attempt",
        "2026-07-04T11:00:00+09:30"
      )
    ).toBe(corrected);
  });

  it("exports event dates by Australian financial year using the referenced immutable version", () => {
    const paid = recordInvoicePayment(
      issue(),
      "invoice-one",
      { date: activityOn, amountCents: 7000, note: "=SYNTHETIC_FORMULA" },
      "payment-one",
      "2026-07-02T11:00:00+09:30",
      activityOn
    );
    const delivered = recordInvoiceDeliveryAttempt(
      paid,
      "invoice-one",
      { date: activityOn, result: "sent", note: "Synthetic manual send" },
      "delivery-one",
      "2026-07-02T12:00:00+09:30",
      activityOn
    );
    const corrected = reviseIssuedInvoice(
      delivered,
      "invoice-one",
      draft({
        customerName: "Synthetic changed customer",
        jobReference: "JOB-CHANGED",
        dueDate: "2026-07-31",
      }),
      "Synthetic profile correction",
      "2026-07-03T11:00:00+09:30"
    );
    const reversed = reverseInvoicePayment(
      corrected,
      "invoice-one",
      "payment-one",
      { date: "2026-07-04", amountCents: 2000, note: "Synthetic reversal" },
      "reversal-one",
      "2026-07-04T11:00:00+09:30",
      "2026-07-04"
    );
    const record = invoice(reversed);
    const annualInvoices = invoicesAnnualCsv([record], "2025-26", true);
    expect(annualInvoices).toContain("JOB-OLD");
    expect(annualInvoices).toContain("JOB-CHANGED");
    expect(annualInvoices).toContain("payment_state");
    expect(annualInvoices).toContain("delivery_state");

    const activityCsv = invoicePaymentActivityAnnualCsv([record], "2026-27");
    const rows = activityCsv.trim().split("\n");
    const paymentRow = rows.find(row => row.includes(',"payment received",'));
    const reversalRow = rows.find(row => row.includes(',"payment reversal",'));
    expect(paymentRow).toContain("Synthetic test customer");
    expect(paymentRow).toContain("JOB-OLD");
    expect(reversalRow).toContain("Synthetic changed customer");
    expect(reversalRow).toContain("JOB-CHANGED");
    expect(reversalRow).toContain("-20.00");
    expect(activityCsv).toContain('"\'=SYNTHETIC_FORMULA"');
    expect(availableInvoiceFinancialYears(activityOn, [record])).toContain(
      "2026-27"
    );
  });

  it("round-trips job references and activity in full backups while accepting historical records", () => {
    const paid = recordInvoicePayment(
      issue(draft({ jobReference: "BACKUP-JOB" })),
      "invoice-one",
      { date: activityOn, amountCents: 1500, note: "Synthetic backup receipt" },
      "payment-one",
      "2026-07-02T11:00:00+09:30",
      activityOn
    );
    const withDelivery = recordInvoiceDeliveryAttempt(
      paid,
      "invoice-one",
      { date: activityOn, result: "failed", note: "Synthetic backup attempt" },
      "delivery-one",
      "2026-07-02T12:00:00+09:30",
      activityOn
    );
    const restored = parseBackup(exportBackup(withDelivery));
    expect(restored.invoices?.[0].draft.jobReference).toBe("BACKUP-JOB");
    expect(restored.invoices?.[0].paymentEvents).toEqual(
      withDelivery.invoices?.[0].paymentEvents
    );
    expect(restored.invoices?.[0].deliveryEvents).toEqual(
      withDelivery.invoices?.[0].deliveryEvents
    );

    const historical = structuredClone(invoice(issue()));
    delete historical.paymentEvents;
    delete historical.deliveryEvents;
    delete historical.draft.jobReference;
    delete historical.versions[0].jobReference;
    const normalized = invoicesField([historical])[0];
    expect(normalized.status).toBe("issued");
    expect(normalized.versions[0].totalCents).toBe(10000);
  });
});
