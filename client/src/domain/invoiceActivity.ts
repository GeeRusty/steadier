import { isDate } from "./time";
import type {
  InvoiceDeliveryEvent,
  InvoicePaymentEvent,
  InvoiceRecord,
  InvoiceVersion,
  Workspace,
} from "./types";

export const MAX_INVOICE_ACTIVITY_EVENTS = 1000;
export const MAX_INVOICE_ACTIVITY_NOTE_LENGTH = 1000;
export const MAX_INVOICE_ACTIVITY_AMOUNT_CENTS = 1_000_000_000_000;

const EVENT_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const PAYMENT_EVENT_KEYS = [
  "id",
  "kind",
  "version",
  "date",
  "amountCents",
  "note",
  "reversalOf",
  "recordedAt",
] as const;
const DELIVERY_EVENT_KEYS = [
  "id",
  "version",
  "date",
  "result",
  "note",
  "recordedAt",
] as const;
const PAYMENT_INPUT_KEYS = ["date", "amountCents", "note"] as const;
const REVERSAL_INPUT_KEYS = ["date", "amountCents", "note"] as const;
const DELIVERY_INPUT_KEYS = ["date", "result", "note"] as const;

export interface InvoicePaymentInput {
  date: string;
  amountCents: number;
  note: string;
}

export interface InvoiceDeliveryInput {
  date: string;
  result: "sent" | "failed";
  note: string;
}

export interface InvoicePaymentSummary {
  grossReceivedCents: number;
  reversedCents: number;
  netReceivedCents: number;
  receivedCents: number;
  balanceDueCents: number;
  creditDueCents: number;
}

export type InvoicePaymentState =
  | "unpaid"
  | "part-paid"
  | "paid"
  | "overdue"
  | "credit-due"
  | "void"
  | null;

export type InvoiceDeliveryState = "not-sent" | "sent" | "failed" | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every(key => keys.includes(key))
  );
}

function validTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    value.trim().length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function normalizeNote(value: unknown, required = false): string | null {
  if (
    typeof value !== "string" ||
    value.length > MAX_INVOICE_ACTIVITY_NOTE_LENGTH
  ) {
    return null;
  }
  const note = value.trim().normalize("NFC");
  if (required && note.length < 3) return null;
  return note;
}

function normalizePaymentEvent(
  value: unknown,
  versionCount: number
): InvoicePaymentEvent | null {
  if (!isRecord(value) || !exactKeys(value, PAYMENT_EVENT_KEYS)) return null;
  const note = normalizeNote(value.note, value.kind === "reversal");
  if (
    typeof value.id !== "string" ||
    !EVENT_ID.test(value.id) ||
    (value.kind !== "payment" && value.kind !== "reversal") ||
    !Number.isInteger(value.version) ||
    (value.version as number) < 1 ||
    (value.version as number) > versionCount ||
    typeof value.date !== "string" ||
    !isDate(value.date) ||
    !Number.isInteger(value.amountCents) ||
    (value.amountCents as number) < 1 ||
    (value.amountCents as number) > MAX_INVOICE_ACTIVITY_AMOUNT_CENTS ||
    note === null ||
    !validTimestamp(value.recordedAt) ||
    (value.kind === "payment" && value.reversalOf !== null) ||
    (value.kind === "reversal" &&
      (typeof value.reversalOf !== "string" ||
        !EVENT_ID.test(value.reversalOf)))
  ) {
    return null;
  }
  return {
    id: value.id,
    kind: value.kind,
    version: value.version as number,
    date: value.date,
    amountCents: value.amountCents as number,
    note,
    reversalOf: value.reversalOf as string | null,
    recordedAt: value.recordedAt,
  };
}

function normalizeDeliveryEvent(value: unknown): InvoiceDeliveryEvent | null {
  if (!isRecord(value) || !exactKeys(value, DELIVERY_EVENT_KEYS)) return null;
  const note = normalizeNote(value.note);
  if (
    typeof value.id !== "string" ||
    !EVENT_ID.test(value.id) ||
    !Number.isInteger(value.version) ||
    (value.version as number) < 1 ||
    typeof value.date !== "string" ||
    !isDate(value.date) ||
    (value.result !== "sent" && value.result !== "failed") ||
    note === null ||
    !validTimestamp(value.recordedAt)
  ) {
    return null;
  }
  return {
    id: value.id,
    version: value.version as number,
    date: value.date,
    result: value.result,
    note,
    recordedAt: value.recordedAt,
  };
}

/**
 * Validate both event streams, preserving old invoice records that have no
 * activity arrays. A reversal must point to an earlier receipt and cannot
 * reverse more than its remaining amount.
 */
export function normalizeInvoiceActivity(
  paymentValue: unknown,
  deliveryValue: unknown,
  versions: readonly InvoiceVersion[],
  recordStatus: InvoiceRecord["status"]
): {
  paymentEvents: InvoicePaymentEvent[];
  deliveryEvents: InvoiceDeliveryEvent[];
} | null {
  if (
    !Array.isArray(paymentValue) ||
    paymentValue.length > MAX_INVOICE_ACTIVITY_EVENTS ||
    !Array.isArray(deliveryValue) ||
    deliveryValue.length > MAX_INVOICE_ACTIVITY_EVENTS
  ) {
    return null;
  }
  const allIds = new Set<string>();
  const paymentEvents: InvoicePaymentEvent[] = [];
  const receipts = new Map<string, InvoicePaymentEvent>();
  const reversed = new Map<string, number>();
  let netReceivedCents = 0;
  let totalReceivedCents = 0;

  for (const raw of paymentValue) {
    const event = normalizePaymentEvent(raw, versions.length);
    const eventVersion = event ? versions[event.version - 1] : null;
    if (!event || allIds.has(event.id)) return null;
    if (!eventVersion || event.date < eventVersion.issueDate) return null;
    allIds.add(event.id);
    if (event.kind === "payment") {
      totalReceivedCents += event.amountCents;
      netReceivedCents += event.amountCents;
      if (
        !Number.isSafeInteger(totalReceivedCents) ||
        !Number.isSafeInteger(netReceivedCents)
      ) {
        return null;
      }
      receipts.set(event.id, event);
    } else {
      const originalPayment = receipts.get(event.reversalOf!);
      if (
        !originalPayment ||
        event.date < originalPayment.date ||
        event.version < originalPayment.version
      ) {
        return null;
      }
      const alreadyReversed = reversed.get(event.reversalOf!) ?? 0;
      const nextReversed = alreadyReversed + event.amountCents;
      if (
        !Number.isSafeInteger(nextReversed) ||
        nextReversed > originalPayment.amountCents
      ) {
        return null;
      }
      reversed.set(event.reversalOf!, nextReversed);
      netReceivedCents -= event.amountCents;
      if (netReceivedCents < 0) return null;
    }
    paymentEvents.push(event);
  }

  const deliveryEvents: InvoiceDeliveryEvent[] = [];
  for (const raw of deliveryValue) {
    const event = normalizeDeliveryEvent(raw);
    const eventVersion = event ? versions[event.version - 1] : null;
    if (
      !event ||
      allIds.has(event.id) ||
      !eventVersion ||
      event.date < eventVersion.issueDate
    ) {
      return null;
    }
    allIds.add(event.id);
    deliveryEvents.push(event);
  }
  if (
    (recordStatus === "draft" &&
      (paymentEvents.length > 0 || deliveryEvents.length > 0)) ||
    (recordStatus === "void" && netReceivedCents !== 0)
  ) {
    return null;
  }
  return { paymentEvents, deliveryEvents };
}

function validNewDate(date: unknown, today: string): date is string {
  return (
    typeof date === "string" && isDate(date) && isDate(today) && date <= today
  );
}

function normalizePaymentInput(
  value: unknown,
  keys: readonly string[],
  today: string,
  requireNote = false
): InvoicePaymentInput | null {
  if (!isRecord(value) || !exactKeys(value, keys)) return null;
  const note = normalizeNote(value.note, requireNote);
  if (
    !validNewDate(value.date, today) ||
    !Number.isInteger(value.amountCents) ||
    (value.amountCents as number) < 1 ||
    (value.amountCents as number) > MAX_INVOICE_ACTIVITY_AMOUNT_CENTS ||
    note === null
  ) {
    return null;
  }
  return {
    date: value.date,
    amountCents: value.amountCents as number,
    note,
  };
}

function isUnusedEventId(record: InvoiceRecord, id: string): boolean {
  return (
    EVENT_ID.test(id) &&
    !(record.paymentEvents ?? []).some(event => event.id === id) &&
    !(record.deliveryEvents ?? []).some(event => event.id === id)
  );
}

export function invoicePaymentSummary(
  record: InvoiceRecord
): InvoicePaymentSummary {
  let grossReceivedCents = 0;
  let reversedCents = 0;
  let receivedCents = 0;
  for (const event of record.paymentEvents ?? []) {
    if (event.kind === "payment") {
      grossReceivedCents += event.amountCents;
      receivedCents += event.amountCents;
    } else {
      reversedCents += event.amountCents;
      receivedCents -= event.amountCents;
    }
  }
  const currentTotal = record.versions.at(-1)?.totalCents ?? 0;
  return {
    grossReceivedCents,
    reversedCents,
    netReceivedCents: receivedCents,
    receivedCents,
    balanceDueCents: Math.max(0, currentTotal - receivedCents),
    creditDueCents: Math.max(0, receivedCents - currentTotal),
  };
}

export function invoicePaymentState(
  record: InvoiceRecord,
  today: string
): InvoicePaymentState {
  if (record.status === "void") return "void";
  const version = record.versions.at(-1);
  if (record.status !== "issued" || !version) return null;
  const summary = invoicePaymentSummary(record);
  if (summary.creditDueCents > 0) return "credit-due";
  if (summary.balanceDueCents === 0) return "paid";
  if (version.dueDate && isDate(today) && version.dueDate < today)
    return "overdue";
  if (summary.receivedCents > 0) return "part-paid";
  return "unpaid";
}

export function invoiceDeliveryState(
  record: InvoiceRecord
): InvoiceDeliveryState {
  if (record.status === "draft" || !record.versions.length) return null;
  const currentVersion = record.versions.at(-1)?.version;
  const events = (record.deliveryEvents ?? []).filter(
    event => event.version === currentVersion
  );
  return events.at(-1)?.result ?? "not-sent";
}

export function invoicePaymentReversibleCents(
  record: InvoiceRecord,
  paymentId: string
): number {
  const payment = (record.paymentEvents ?? []).find(
    event => event.id === paymentId && event.kind === "payment"
  );
  if (!payment) return 0;
  const reversed = (record.paymentEvents ?? [])
    .filter(
      event => event.kind === "reversal" && event.reversalOf === paymentId
    )
    .reduce((total, event) => total + event.amountCents, 0);
  return Math.max(0, payment.amountCents - reversed);
}

export function recordInvoicePayment(
  workspace: Workspace,
  invoiceId: string,
  input: InvoicePaymentInput,
  eventId: string,
  recordedAt: string,
  today: string
): Workspace {
  const normalized = normalizePaymentInput(input, PAYMENT_INPUT_KEYS, today);
  const record = workspace.invoices?.find(
    invoice => invoice.id === invoiceId && invoice.status === "issued"
  );
  const latest = record?.versions.at(-1);
  if (
    !normalized ||
    !record ||
    !latest ||
    normalized.date < latest.issueDate ||
    !validTimestamp(recordedAt) ||
    !isUnusedEventId(record, eventId)
  ) {
    return workspace;
  }
  const summary = invoicePaymentSummary(record);
  if (
    summary.creditDueCents > 0 ||
    normalized.amountCents > summary.balanceDueCents ||
    (record.paymentEvents ?? []).length >= MAX_INVOICE_ACTIVITY_EVENTS
  ) {
    return workspace;
  }
  const event: InvoicePaymentEvent = {
    id: eventId,
    kind: "payment",
    version: latest.version,
    date: normalized.date,
    amountCents: normalized.amountCents,
    note: normalized.note,
    reversalOf: null,
    recordedAt,
  };
  return {
    ...workspace,
    invoices: workspace.invoices?.map(invoice =>
      invoice.id === invoiceId
        ? {
            ...invoice,
            paymentEvents: [...(invoice.paymentEvents ?? []), event],
            updatedAt: recordedAt,
          }
        : invoice
    ),
  };
}

export function reverseInvoicePayment(
  workspace: Workspace,
  invoiceId: string,
  paymentId: string,
  input: InvoicePaymentInput,
  eventId: string,
  recordedAt: string,
  today: string
): Workspace {
  const normalized = normalizePaymentInput(
    input,
    REVERSAL_INPUT_KEYS,
    today,
    true
  );
  const record = workspace.invoices?.find(
    invoice => invoice.id === invoiceId && invoice.status === "issued"
  );
  const latest = record?.versions.at(-1);
  const originalPayment = record?.paymentEvents?.find(
    event => event.id === paymentId && event.kind === "payment"
  );
  if (
    !normalized ||
    !record ||
    !latest ||
    !originalPayment ||
    normalized.date < originalPayment.date ||
    !validTimestamp(recordedAt) ||
    !isUnusedEventId(record, eventId) ||
    normalized.amountCents > invoicePaymentReversibleCents(record, paymentId) ||
    (record.paymentEvents ?? []).length >= MAX_INVOICE_ACTIVITY_EVENTS
  ) {
    return workspace;
  }
  const event: InvoicePaymentEvent = {
    id: eventId,
    kind: "reversal",
    version: latest.version,
    date: normalized.date,
    amountCents: normalized.amountCents,
    note: normalized.note,
    reversalOf: paymentId,
    recordedAt,
  };
  return {
    ...workspace,
    invoices: workspace.invoices?.map(invoice =>
      invoice.id === invoiceId
        ? {
            ...invoice,
            paymentEvents: [...(invoice.paymentEvents ?? []), event],
            updatedAt: recordedAt,
          }
        : invoice
    ),
  };
}

export function recordInvoiceDeliveryAttempt(
  workspace: Workspace,
  invoiceId: string,
  input: InvoiceDeliveryInput,
  eventId: string,
  recordedAt: string,
  today: string
): Workspace {
  const record = workspace.invoices?.find(
    invoice => invoice.id === invoiceId && invoice.status === "issued"
  );
  const latestVersion = record?.versions.at(-1);
  if (
    !record ||
    !latestVersion ||
    !isRecord(input) ||
    !exactKeys(input, DELIVERY_INPUT_KEYS) ||
    !validNewDate(input.date, today) ||
    input.date < latestVersion.issueDate ||
    (input.result !== "sent" && input.result !== "failed") ||
    normalizeNote(input.note) === null ||
    !validTimestamp(recordedAt) ||
    !isUnusedEventId(record, eventId) ||
    (record.deliveryEvents ?? []).length >= MAX_INVOICE_ACTIVITY_EVENTS
  ) {
    return workspace;
  }
  const event: InvoiceDeliveryEvent = {
    id: eventId,
    version: latestVersion.version,
    date: input.date,
    result: input.result,
    note: normalizeNote(input.note)!,
    recordedAt,
  };
  return {
    ...workspace,
    invoices: workspace.invoices?.map(invoice =>
      invoice.id === invoiceId
        ? {
            ...invoice,
            deliveryEvents: [...(invoice.deliveryEvents ?? []), event],
            updatedAt: recordedAt,
          }
        : invoice
    ),
  };
}

function financialYearStart(financialYear: string): number | null {
  const match = /^(\d{4})-(\d{2})$/.exec(financialYear);
  if (!match) return null;
  const start = Number(match[1]);
  return Number(match[2]) === (start + 1) % 100 ? start : null;
}

function financialYearForDate(date: string): string {
  if (!isDate(date)) return "";
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const start = month >= 7 ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

function csvCell(value: string | number | boolean | null): string {
  let text = value === null ? "" : String(value);
  if (/^[\s]*[=+@\-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function invoicePaymentActivityAnnualCsv(
  records: readonly InvoiceRecord[],
  financialYear: string
): string {
  const startYear = financialYearStart(financialYear);
  if (startYear === null) return "";
  const start = `${startYear}-07-01`;
  const end = `${startYear + 1}-06-30`;
  const header = [
    "financial_year",
    "event_date",
    "event_type",
    "invoice_number",
    "invoice_version_at_event",
    "record_status",
    "customer_name",
    "job_reference",
    "amount_aud",
    "reversal_of_event",
    "note",
    "recorded_at",
  ];
  const rows = [header.map(csvCell).join(",")];
  const activityRows: {
    date: string;
    invoiceNumber: string;
    recordedAt: string;
    row: string;
  }[] = [];
  for (const record of records) {
    const latest = record.versions.at(-1);
    if (!latest || !record.invoiceNumber) continue;
    for (const event of record.paymentEvents ?? []) {
      if (event.date < start || event.date > end) continue;
      const version = record.versions[event.version - 1];
      if (!version) continue;
      activityRows.push({
        date: event.date,
        invoiceNumber: record.invoiceNumber,
        recordedAt: event.recordedAt,
        row: [
          financialYearForDate(event.date),
          event.date,
          event.kind === "payment" ? "payment received" : "payment reversal",
          record.invoiceNumber,
          event.version,
          record.status,
          version.customerName,
          version.jobReference ?? "",
          (
            (event.kind === "reversal"
              ? -event.amountCents
              : event.amountCents) / 100
          ).toFixed(2),
          event.reversalOf,
          event.note,
          event.recordedAt,
        ]
          .map(csvCell)
          .join(","),
      });
    }
  }
  activityRows
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.invoiceNumber.localeCompare(right.invoiceNumber) ||
        left.recordedAt.localeCompare(right.recordedAt)
    )
    .forEach(event => rows.push(event.row));
  return `\uFEFF${rows.join("\r\n")}\r\n`;
}
