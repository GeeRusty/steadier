import { isDate } from "./time";
import type {
  InvoiceDraft,
  InvoiceGstMode,
  InvoiceLineItem,
  InvoiceRecord,
  InvoiceSettings,
  InvoiceVersion,
  Workspace,
} from "./types";
import {
  invoiceDeliveryState,
  invoicePaymentState,
  invoicePaymentSummary,
  normalizeInvoiceActivity,
} from "./invoiceActivity";

export const MAX_INVOICES = 5000;
export const MAX_INVOICE_LINES = 50;
export const MAX_INVOICE_VERSIONS = 100;
export const MAX_INVOICE_DESCRIPTION_LENGTH = 2000;
export const MAX_INVOICE_REASON_LENGTH = 1000;
export const MAX_INVOICE_JOB_REFERENCE_LENGTH = 120;
export const MAX_INVOICE_TOTAL_CENTS = 1_000_000_000_000;
export const MAX_ISSUABLE_INVOICE_NUMBER = 99_999_999;
const MAX_NEXT_INVOICE_NUMBER = MAX_ISSUABLE_INVOICE_NUMBER + 1;

const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const INVOICE_NUMBER = /^INV-\d{4,8}$/;
const GST_MODES = ["off", "exclusive", "inclusive"] as const;
const SETTINGS_KEYS = [
  "supplierName",
  "supplierAddress",
  "supplierAbn",
  "gstMode",
  "gstConfirmedAt",
  "gstConfirmedProfile",
  "nextInvoiceNumber",
  "updatedAt",
] as const;
const LEGACY_SETTINGS_KEYS = [
  "supplierName",
  "supplierAddress",
  "supplierAbn",
  "gstMode",
  "gstConfirmedAt",
  "nextInvoiceNumber",
  "updatedAt",
] as const;
const LEGACY_DRAFT_KEYS = [
  "issueDate",
  "dueDate",
  "customerName",
  "customerAddress",
  "customerAbn",
  "lines",
] as const;
const DRAFT_KEYS = [...LEGACY_DRAFT_KEYS, "jobReference"] as const;
const LINE_KEYS = [
  "id",
  "description",
  "quantityMilli",
  "unitPriceCents",
] as const;
const LEGACY_VERSION_KEYS = [
  "invoiceNumber",
  "version",
  "issueDate",
  "dueDate",
  "customerName",
  "customerAddress",
  "customerAbn",
  "lines",
  "supplierName",
  "supplierAddress",
  "supplierAbn",
  "gstMode",
  "subtotalCents",
  "gstCents",
  "totalCents",
  "issuedAt",
  "correctionReason",
] as const;
const VERSION_KEYS = [
  "invoiceNumber",
  "version",
  "issueDate",
  "dueDate",
  "customerName",
  "customerAddress",
  "customerAbn",
  "jobReference",
  "lines",
  "supplierName",
  "supplierAddress",
  "supplierAbn",
  "gstMode",
  "subtotalCents",
  "gstCents",
  "totalCents",
  "issuedAt",
  "correctionReason",
] as const;
const LEGACY_RECORD_KEYS = [
  "id",
  "invoiceNumber",
  "status",
  "draft",
  "versions",
  "voidedAt",
  "voidReason",
  "createdAt",
  "updatedAt",
] as const;
const RECORD_KEYS = [
  ...LEGACY_RECORD_KEYS,
  "deliveryEvents",
  "paymentEvents",
] as const;

export function emptyInvoiceSettings(at: string): InvoiceSettings {
  return {
    supplierName: "",
    supplierAddress: "",
    supplierAbn: "",
    gstMode: "off",
    gstConfirmedAt: null,
    gstConfirmedProfile: null,
    nextInvoiceNumber: 1,
    updatedAt: at,
  };
}

export function emptyInvoiceDraft(day: string): InvoiceDraft {
  return {
    issueDate: day,
    dueDate: null,
    customerName: "",
    customerAddress: "",
    customerAbn: "",
    jobReference: "",
    lines: [],
  };
}

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

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length <= max;
}

function isGstMode(value: unknown): value is InvoiceGstMode {
  return (
    typeof value === "string" && GST_MODES.includes(value as InvoiceGstMode)
  );
}

/** Checks the ABN checksum only; this does not verify registration on the ABR. */
export function isValidAbn(value: string): boolean {
  const digits = value.replace(/[\s-]/g, "");
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const values = digits.split("").map(Number);
  values[0] -= 1;
  return (
    values.reduce((total, digit, index) => total + digit * weights[index], 0) %
      89 ===
    0
  );
}

function normalizeAbn(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/[\s-]/g, "");
  return isValidAbn(digits) ? digits : null;
}

function normalizeConfirmedProfile(
  value: unknown
): InvoiceSettings["gstConfirmedProfile"] | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !exactKeys(value, ["supplierName", "supplierAddress", "supplierAbn"])
  ) {
    return null;
  }
  const supplierAbn = normalizeAbn(value.supplierAbn);
  if (
    !boundedText(value.supplierName, 200) ||
    !value.supplierName.trim() ||
    !boundedText(value.supplierAddress, 500) ||
    !value.supplierAddress.trim() ||
    supplierAbn === null ||
    !supplierAbn
  ) {
    return null;
  }
  return {
    supplierName: value.supplierName.trim().normalize("NFC"),
    supplierAddress: value.supplierAddress.trim().normalize("NFC"),
    supplierAbn,
  };
}

function supplierProfileMatches(
  current: InvoiceSettings,
  confirmed: InvoiceSettings["gstConfirmedProfile"]
): boolean {
  return Boolean(
    confirmed &&
      confirmed.supplierName === current.supplierName.trim().normalize("NFC") &&
      confirmed.supplierAddress ===
        current.supplierAddress.trim().normalize("NFC") &&
      confirmed.supplierAbn === current.supplierAbn
  );
}

export function isGstConfirmationCurrent(settings: InvoiceSettings): boolean {
  return (
    settings.gstMode === "off" ||
    (validTimestamp(settings.gstConfirmedAt) &&
      supplierProfileMatches(settings, settings.gstConfirmedProfile))
  );
}

export function formatAbn(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11
    ? `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`
    : value;
}

function normalizeSettings(value: unknown): InvoiceSettings | null {
  if (
    !isRecord(value) ||
    (!exactKeys(value, SETTINGS_KEYS) &&
      !exactKeys(value, LEGACY_SETTINGS_KEYS))
  )
    return null;
  const supplierAbn = normalizeAbn(value.supplierAbn);
  const gstConfirmedProfile = normalizeConfirmedProfile(
    "gstConfirmedProfile" in value ? value.gstConfirmedProfile : null
  );
  if (
    "gstConfirmedProfile" in value &&
    value.gstConfirmedProfile !== null &&
    gstConfirmedProfile === null
  ) {
    return null;
  }
  if (
    !boundedText(value.supplierName, 200) ||
    !boundedText(value.supplierAddress, 500) ||
    supplierAbn === null ||
    !isGstMode(value.gstMode) ||
    !Number.isInteger(value.nextInvoiceNumber) ||
    (value.nextInvoiceNumber as number) < 1 ||
    (value.nextInvoiceNumber as number) > MAX_NEXT_INVOICE_NUMBER ||
    !validTimestamp(value.updatedAt)
  ) {
    return null;
  }
  if (value.gstMode === "off") {
    if (value.gstConfirmedAt !== null || gstConfirmedProfile !== null)
      return null;
  } else if (!validTimestamp(value.gstConfirmedAt) || !supplierAbn) {
    return null;
  }
  return {
    supplierName: value.supplierName.trim(),
    supplierAddress: value.supplierAddress.trim(),
    supplierAbn,
    gstMode: value.gstMode,
    gstConfirmedAt: value.gstConfirmedAt as string | null,
    gstConfirmedProfile,
    nextInvoiceNumber: value.nextInvoiceNumber as number,
    updatedAt: value.updatedAt,
  };
}

export function invoiceSettingsField(value: unknown): InvoiceSettings {
  const settings = normalizeSettings(value);
  if (!settings)
    throw new Error("Invoice settings contain invalid or unsupported fields.");
  return settings;
}

function normalizeLine(
  value: unknown,
  allowIncomplete: boolean
): InvoiceLineItem | null {
  if (!isRecord(value) || !exactKeys(value, LINE_KEYS)) return null;
  if (
    typeof value.id !== "string" ||
    !ID.test(value.id) ||
    !boundedText(value.description, MAX_INVOICE_DESCRIPTION_LENGTH) ||
    !Number.isInteger(value.quantityMilli) ||
    (value.quantityMilli as number) < (allowIncomplete ? 0 : 1) ||
    (value.quantityMilli as number) > 1_000_000_000 ||
    !Number.isInteger(value.unitPriceCents) ||
    (value.unitPriceCents as number) < 0 ||
    (value.unitPriceCents as number) > MAX_INVOICE_TOTAL_CENTS
  ) {
    return null;
  }
  if (!allowIncomplete && !value.description.trim()) return null;
  return {
    id: value.id,
    description: value.description.trim(),
    quantityMilli: value.quantityMilli as number,
    unitPriceCents: value.unitPriceCents as number,
  };
}

function normalizeDraft(
  value: unknown,
  allowIncomplete: boolean
): InvoiceDraft | null {
  if (
    !isRecord(value) ||
    (!exactKeys(value, DRAFT_KEYS) && !exactKeys(value, LEGACY_DRAFT_KEYS))
  )
    return null;
  const jobReference = "jobReference" in value ? value.jobReference : "";
  const customerAbn = normalizeAbn(value.customerAbn);
  if (
    typeof value.issueDate !== "string" ||
    !isDate(value.issueDate) ||
    (value.dueDate !== null &&
      (typeof value.dueDate !== "string" ||
        !isDate(value.dueDate) ||
        value.dueDate < value.issueDate)) ||
    !boundedText(value.customerName, 200) ||
    !boundedText(value.customerAddress, 500) ||
    !boundedText(jobReference, MAX_INVOICE_JOB_REFERENCE_LENGTH) ||
    customerAbn === null ||
    !Array.isArray(value.lines) ||
    value.lines.length > MAX_INVOICE_LINES
  ) {
    return null;
  }
  const ids = new Set<string>();
  const lines: InvoiceLineItem[] = [];
  for (const rawLine of value.lines) {
    const line = normalizeLine(rawLine, allowIncomplete);
    if (!line || ids.has(line.id)) return null;
    ids.add(line.id);
    lines.push(line);
  }
  if (!allowIncomplete && (!value.customerName.trim() || !lines.length))
    return null;
  return {
    issueDate: value.issueDate,
    dueDate: value.dueDate as string | null,
    customerName: value.customerName.trim(),
    customerAddress: value.customerAddress.trim(),
    customerAbn,
    jobReference: jobReference.trim(),
    lines,
  };
}

export function normalizeInvoiceDraft(
  input: InvoiceDraft,
  requireComplete = false
): InvoiceDraft | null {
  return normalizeDraft(input, !requireComplete);
}

export function calculateInvoiceTotals(
  lines: readonly InvoiceLineItem[],
  gstMode: InvoiceGstMode
): { subtotalCents: number; gstCents: number; totalCents: number } | null {
  if (!isGstMode(gstMode) || lines.length > MAX_INVOICE_LINES) return null;
  let lineSum = 0;
  for (const line of lines) {
    if (
      !Number.isInteger(line.quantityMilli) ||
      line.quantityMilli < 1 ||
      !Number.isInteger(line.unitPriceCents) ||
      line.unitPriceCents < 0
    ) {
      return null;
    }
    const lineTotal = Math.round(
      (line.quantityMilli * line.unitPriceCents) / 1000
    );
    if (!Number.isSafeInteger(lineTotal) || lineTotal < 0) return null;
    lineSum += lineTotal;
    if (!Number.isSafeInteger(lineSum) || lineSum > MAX_INVOICE_TOTAL_CENTS)
      return null;
  }
  const gstCents =
    gstMode === "exclusive"
      ? Math.round((lineSum * 10) / 100)
      : gstMode === "inclusive"
        ? Math.round((lineSum * 10) / 110)
        : 0;
  const subtotalCents = gstMode === "inclusive" ? lineSum - gstCents : lineSum;
  const totalCents = gstMode === "exclusive" ? lineSum + gstCents : lineSum;
  if (
    !Number.isSafeInteger(gstCents) ||
    !Number.isSafeInteger(subtotalCents) ||
    !Number.isSafeInteger(totalCents) ||
    totalCents > MAX_INVOICE_TOTAL_CENTS
  ) {
    return null;
  }
  return { subtotalCents, gstCents, totalCents };
}

function validIssuedDraft(value: unknown): InvoiceDraft | null {
  const draft = normalizeDraft(value, false);
  if (!draft || !draft.customerName || !draft.lines.length) return null;
  if (draft.lines.some(line => !line.description || line.quantityMilli < 1))
    return null;
  return draft;
}

function makeSnapshot(
  draftValue: unknown,
  invoiceNumber: string,
  version: number,
  supplier: Pick<
    InvoiceSettings,
    "supplierName" | "supplierAddress" | "supplierAbn" | "gstMode"
  >,
  issuedAt: string,
  correctionReason: string | null
): InvoiceVersion | null {
  const draft = validIssuedDraft(draftValue);
  const supplierAbn = normalizeAbn(supplier.supplierAbn);
  if (
    !draft ||
    !INVOICE_NUMBER.test(invoiceNumber) ||
    !Number.isInteger(version) ||
    version < 1 ||
    version > MAX_INVOICE_VERSIONS ||
    !boundedText(supplier.supplierName, 200) ||
    !supplier.supplierName.trim() ||
    !boundedText(supplier.supplierAddress, 500) ||
    !supplier.supplierAddress.trim() ||
    supplierAbn === null ||
    !supplierAbn ||
    !GST_MODES.includes(supplier.gstMode) ||
    !validTimestamp(issuedAt) ||
    (version === 1 && correctionReason !== null) ||
    (version > 1 &&
      (!boundedText(correctionReason, MAX_INVOICE_REASON_LENGTH) ||
        !correctionReason.trim()))
  ) {
    return null;
  }
  const totals = calculateInvoiceTotals(draft.lines, supplier.gstMode);
  if (!totals) return null;
  return {
    ...draft,
    invoiceNumber,
    version,
    supplierName: supplier.supplierName.trim(),
    supplierAddress: supplier.supplierAddress.trim(),
    supplierAbn,
    gstMode: supplier.gstMode,
    ...totals,
    issuedAt,
    correctionReason: correctionReason?.trim() ?? null,
  };
}

function normalizeVersion(value: unknown): InvoiceVersion | null {
  if (
    !isRecord(value) ||
    (!exactKeys(value, VERSION_KEYS) && !exactKeys(value, LEGACY_VERSION_KEYS))
  )
    return null;
  if (
    typeof value.invoiceNumber !== "string" ||
    !INVOICE_NUMBER.test(value.invoiceNumber) ||
    !Number.isInteger(value.version) ||
    typeof value.supplierName !== "string" ||
    typeof value.supplierAddress !== "string" ||
    typeof value.supplierAbn !== "string" ||
    !isGstMode(value.gstMode) ||
    !Number.isInteger(value.subtotalCents) ||
    !Number.isInteger(value.gstCents) ||
    !Number.isInteger(value.totalCents) ||
    !validTimestamp(value.issuedAt) ||
    (typeof value.correctionReason !== "string" &&
      value.correctionReason !== null)
  ) {
    return null;
  }
  const draft = normalizeDraft(
    {
      issueDate: value.issueDate,
      dueDate: value.dueDate,
      customerName: value.customerName,
      customerAddress: value.customerAddress,
      customerAbn: value.customerAbn,
      jobReference: "jobReference" in value ? value.jobReference : "",
      lines: value.lines,
    },
    false
  );
  if (!draft) return null;
  const snapshot = makeSnapshot(
    draft,
    value.invoiceNumber,
    value.version as number,
    {
      supplierName: value.supplierName,
      supplierAddress: value.supplierAddress,
      supplierAbn: value.supplierAbn,
      gstMode: value.gstMode,
    },
    value.issuedAt,
    value.correctionReason as string | null
  );
  if (
    !snapshot ||
    snapshot.subtotalCents !== value.subtotalCents ||
    snapshot.gstCents !== value.gstCents ||
    snapshot.totalCents !== value.totalCents
  ) {
    return null;
  }
  return snapshot;
}

function sameDraft(left: InvoiceDraft, right: InvoiceDraft): boolean {
  return (
    left.issueDate === right.issueDate &&
    left.dueDate === right.dueDate &&
    left.customerName === right.customerName &&
    left.customerAddress === right.customerAddress &&
    left.customerAbn === right.customerAbn &&
    (left.jobReference ?? "") === (right.jobReference ?? "") &&
    left.lines.length === right.lines.length &&
    left.lines.every((line, index) => {
      const other = right.lines[index];
      return (
        line.id === other.id &&
        line.description === other.description &&
        line.quantityMilli === other.quantityMilli &&
        line.unitPriceCents === other.unitPriceCents
      );
    })
  );
}

export function invoicesField(value: unknown): InvoiceRecord[] {
  if (!Array.isArray(value) || value.length > MAX_INVOICES) {
    throw new Error(
      `Invoices must be a list of at most ${MAX_INVOICES} records.`
    );
  }
  const ids = new Set<string>();
  const numbers = new Set<string>();
  return value.map((raw, index) => {
    const label = `invoice ${index + 1}`;
    if (
      !isRecord(raw) ||
      (!exactKeys(raw, RECORD_KEYS) && !exactKeys(raw, LEGACY_RECORD_KEYS))
    ) {
      throw new Error(`${label} contains unsupported fields.`);
    }
    if (typeof raw.id !== "string" || !ID.test(raw.id) || ids.has(raw.id)) {
      throw new Error(`${label} has an invalid or duplicate ID.`);
    }
    if (
      raw.status !== "draft" &&
      raw.status !== "issued" &&
      raw.status !== "void"
    ) {
      throw new Error(`${label} has an unsupported status.`);
    }
    const draft = normalizeDraft(raw.draft, true);
    if (
      !draft ||
      !Array.isArray(raw.versions) ||
      raw.versions.length > MAX_INVOICE_VERSIONS
    ) {
      throw new Error(`${label} has an invalid draft or version history.`);
    }
    const versions = raw.versions.map(normalizeVersion);
    if (versions.some(version => !version)) {
      throw new Error(`${label} contains an invalid issued version.`);
    }
    const typedVersions = versions as InvoiceVersion[];
    const activity = normalizeInvoiceActivity(
      "paymentEvents" in raw ? raw.paymentEvents : [],
      "deliveryEvents" in raw ? raw.deliveryEvents : [],
      typedVersions,
      raw.status
    );
    if (!activity) {
      throw new Error(`${label} has invalid payment or delivery history.`);
    }
    const invoiceNumber = raw.invoiceNumber;
    if (
      invoiceNumber !== null &&
      (typeof invoiceNumber !== "string" || !INVOICE_NUMBER.test(invoiceNumber))
    ) {
      throw new Error(`${label} has an invalid invoice number.`);
    }
    const voidedAt = raw.voidedAt;
    const voidReason = raw.voidReason;
    if (raw.status === "draft") {
      if (
        invoiceNumber !== null ||
        typedVersions.length ||
        voidedAt !== null ||
        voidReason !== null
      ) {
        throw new Error(`${label} draft has issued or voided fields.`);
      }
    } else if (raw.status === "issued") {
      if (
        typeof invoiceNumber !== "string" ||
        !typedVersions.length ||
        voidedAt !== null ||
        voidReason !== null
      ) {
        throw new Error(`${label} issued record is incomplete.`);
      }
    } else if (
      !validTimestamp(voidedAt) ||
      !boundedText(voidReason, MAX_INVOICE_REASON_LENGTH) ||
      !String(voidReason).trim()
    ) {
      throw new Error(`${label} void reason or timestamp is invalid.`);
    } else if (!typedVersions.length && invoiceNumber !== null) {
      throw new Error(
        `${label} unissued void record cannot have an invoice number.`
      );
    }
    if (typedVersions.length) {
      if (
        typeof invoiceNumber !== "string" ||
        typedVersions.some(
          (version, versionIndex) =>
            version.invoiceNumber !== invoiceNumber ||
            version.version !== versionIndex + 1
        ) ||
        !sameDraft(draft, typedVersions[typedVersions.length - 1])
      ) {
        throw new Error(`${label} version history is inconsistent.`);
      }
      if (numbers.has(invoiceNumber)) {
        throw new Error(`Invoice number ${invoiceNumber} is duplicated.`);
      }
      numbers.add(invoiceNumber);
    }
    if (!validTimestamp(raw.createdAt) || !validTimestamp(raw.updatedAt)) {
      throw new Error(`${label} timestamps are invalid.`);
    }
    ids.add(raw.id);
    return {
      id: raw.id,
      invoiceNumber: invoiceNumber as string | null,
      status: raw.status,
      draft,
      versions: typedVersions,
      deliveryEvents: activity.deliveryEvents,
      paymentEvents: activity.paymentEvents,
      voidedAt: voidedAt as string | null,
      voidReason: voidReason as string | null,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  });
}

export function validateInvoiceSequence(
  settings: InvoiceSettings | undefined,
  invoices: readonly InvoiceRecord[] | undefined
): void {
  if (!settings) return;
  let highestIssuedNumber = 0;
  for (const invoice of invoices ?? []) {
    if (!invoice.invoiceNumber) continue;
    const sequence = Number(invoice.invoiceNumber.slice(4));
    if (Number.isSafeInteger(sequence))
      highestIssuedNumber = Math.max(highestIssuedNumber, sequence);
  }
  if (settings.nextInvoiceNumber <= highestIssuedNumber) {
    throw new Error(
      "Next invoice number must be greater than every issued or voided invoice number."
    );
  }
}

function recordsWithNextSequence(
  settings: InvoiceSettings,
  invoices: readonly InvoiceRecord[]
): InvoiceSettings {
  let highestIssuedNumber = 0;
  for (const invoice of invoices) {
    if (invoice.invoiceNumber) {
      highestIssuedNumber = Math.max(
        highestIssuedNumber,
        Number(invoice.invoiceNumber.slice(4)) || 0
      );
    }
  }
  return {
    ...settings,
    nextInvoiceNumber: Math.max(
      settings.nextInvoiceNumber,
      highestIssuedNumber + 1
    ),
  };
}

export function saveInvoiceSettings(
  workspace: Workspace,
  input: InvoiceSettings,
  at: string
): Workspace {
  const normalized = normalizeSettings({ ...input, updatedAt: at });
  if (!normalized || !validTimestamp(at)) return workspace;
  const invoices = workspace.invoices ?? [];
  const safeSettings = recordsWithNextSequence(normalized, invoices);
  return { ...workspace, invoiceSettings: safeSettings };
}

export function createInvoiceDraft(
  workspace: Workspace,
  input: InvoiceDraft,
  id: string,
  at: string
): Workspace {
  const normalized = normalizeInvoiceDraft(input);
  const invoices = workspace.invoices ?? [];
  if (
    !normalized ||
    !ID.test(id) ||
    !validTimestamp(at) ||
    invoices.length >= MAX_INVOICES ||
    invoices.some(invoice => invoice.id === id)
  ) {
    return workspace;
  }
  const record: InvoiceRecord = {
    id,
    invoiceNumber: null,
    status: "draft",
    draft: normalized,
    versions: [],
    deliveryEvents: [],
    paymentEvents: [],
    voidedAt: null,
    voidReason: null,
    createdAt: at,
    updatedAt: at,
  };
  return { ...workspace, invoices: [...invoices, record] };
}

export function updateInvoiceDraft(
  workspace: Workspace,
  id: string,
  input: InvoiceDraft,
  at: string
): Workspace {
  const normalized = normalizeInvoiceDraft(input);
  const invoices = workspace.invoices ?? [];
  if (!normalized || !validTimestamp(at)) return workspace;
  const existing = invoices.find(
    invoice => invoice.id === id && invoice.status === "draft"
  );
  if (!existing) return workspace;
  return {
    ...workspace,
    invoices: invoices.map(invoice =>
      invoice.id === id
        ? { ...invoice, draft: normalized, updatedAt: at }
        : invoice
    ),
  };
}

export function formatInvoiceNumber(sequence: number): string | null {
  if (
    !Number.isInteger(sequence) ||
    sequence < 1 ||
    sequence > MAX_ISSUABLE_INVOICE_NUMBER
  )
    return null;
  return `INV-${String(sequence).padStart(4, "0")}`;
}

function profileReady(settings: InvoiceSettings): boolean {
  return Boolean(
    settings.supplierName.trim() &&
      settings.supplierAddress.trim() &&
      isValidAbn(settings.supplierAbn) &&
      isGstConfirmationCurrent(settings)
  );
}

function settingsSupplier(settings: InvoiceSettings) {
  return {
    supplierName: settings.supplierName,
    supplierAddress: settings.supplierAddress,
    supplierAbn: settings.supplierAbn,
    gstMode: settings.gstMode,
  };
}

export function canIssueInvoice(
  draft: InvoiceDraft,
  settings: InvoiceSettings | undefined
): boolean {
  if (
    !settings ||
    !profileReady(settings) ||
    settings.nextInvoiceNumber > MAX_ISSUABLE_INVOICE_NUMBER
  ) {
    return false;
  }
  return validIssuedDraft(draft) !== null;
}

export function issueInvoiceDraft(
  workspace: Workspace,
  id: string,
  at: string
): Workspace {
  const settings = workspace.invoiceSettings;
  const invoices = workspace.invoices ?? [];
  const record = invoices.find(
    invoice => invoice.id === id && invoice.status === "draft"
  );
  if (
    !settings ||
    !record ||
    !validTimestamp(at) ||
    !profileReady(settings) ||
    settings.nextInvoiceNumber > MAX_ISSUABLE_INVOICE_NUMBER
  )
    return workspace;
  const invoiceNumber = formatInvoiceNumber(settings.nextInvoiceNumber);
  if (
    !invoiceNumber ||
    invoices.some(invoice => invoice.invoiceNumber === invoiceNumber)
  ) {
    return workspace;
  }
  const snapshot = makeSnapshot(
    record.draft,
    invoiceNumber,
    1,
    settingsSupplier(settings),
    at,
    null
  );
  if (!snapshot) return workspace;
  return {
    ...workspace,
    invoiceSettings: {
      ...settings,
      nextInvoiceNumber: settings.nextInvoiceNumber + 1,
      updatedAt: at,
    },
    invoices: invoices.map(invoice =>
      invoice.id === id
        ? {
            ...invoice,
            invoiceNumber,
            status: "issued",
            draft: record.draft,
            versions: [snapshot],
            updatedAt: at,
          }
        : invoice
    ),
  };
}

export function reviseIssuedInvoice(
  workspace: Workspace,
  id: string,
  input: InvoiceDraft,
  correctionReason: string,
  at: string
): Workspace {
  const invoices = workspace.invoices ?? [];
  const record = invoices.find(
    invoice => invoice.id === id && invoice.status === "issued"
  );
  const normalized = normalizeInvoiceDraft(input, true);
  const reason = correctionReason.trim();
  const latest = record?.versions.at(-1);
  if (
    !record ||
    !normalized ||
    !latest ||
    reason.length < 3 ||
    reason.length > MAX_INVOICE_REASON_LENGTH ||
    record.versions.length >= MAX_INVOICE_VERSIONS ||
    !validTimestamp(at)
  ) {
    return workspace;
  }
  const snapshot = makeSnapshot(
    normalized,
    latest.invoiceNumber,
    latest.version + 1,
    {
      supplierName: latest.supplierName,
      supplierAddress: latest.supplierAddress,
      supplierAbn: latest.supplierAbn,
      gstMode: latest.gstMode,
    },
    at,
    reason
  );
  if (!snapshot) return workspace;
  return {
    ...workspace,
    invoices: invoices.map(invoice =>
      invoice.id === id
        ? {
            ...invoice,
            draft: normalized,
            versions: [...invoice.versions, snapshot],
            updatedAt: at,
          }
        : invoice
    ),
  };
}

export function voidInvoice(
  workspace: Workspace,
  id: string,
  reason: string,
  at: string
): Workspace {
  const invoices = workspace.invoices ?? [];
  const record = invoices.find(
    invoice => invoice.id === id && invoice.status !== "void"
  );
  const normalizedReason = reason.trim();
  if (
    !record ||
    normalizedReason.length < 3 ||
    normalizedReason.length > MAX_INVOICE_REASON_LENGTH ||
    !validTimestamp(at) ||
    invoicePaymentSummary(record).receivedCents !== 0
  ) {
    return workspace;
  }
  return {
    ...workspace,
    invoices: invoices.map(invoice =>
      invoice.id === id
        ? {
            ...invoice,
            status: "void",
            voidedAt: at,
            voidReason: normalizedReason,
            updatedAt: at,
          }
        : invoice
    ),
  };
}

export function getCurrentInvoiceVersion(
  record: InvoiceRecord
): InvoiceVersion | null {
  return record.versions.at(-1) ?? null;
}

export function australianFinancialYear(issueDate: string): string {
  const year = Number(issueDate.slice(0, 4));
  const month = Number(issueDate.slice(5, 7));
  if (!isDate(issueDate) || !Number.isInteger(year) || month < 1 || month > 12)
    return "";
  const start = month >= 7 ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

export function financialYearStart(financialYear: string): number | null {
  const match = /^(\d{4})-(\d{2})$/.exec(financialYear);
  if (!match) return null;
  const start = Number(match[1]);
  return Number(match[2]) === (start + 1) % 100 ? start : null;
}

export function availableInvoiceFinancialYears(
  day: string,
  records: readonly InvoiceRecord[]
): string[] {
  const years = new Set<string>();
  const currentStart = financialYearStart(australianFinancialYear(day));
  if (currentStart !== null) {
    for (let offset = 0; offset < 10; offset += 1) {
      const start = currentStart - offset;
      years.add(`${start}-${String(start + 1).slice(-2)}`);
    }
  }
  for (const record of records) {
    for (const version of record.versions) {
      const financialYear = australianFinancialYear(version.issueDate);
      if (financialYear) years.add(financialYear);
    }
    for (const event of record.paymentEvents ?? []) {
      const financialYear = australianFinancialYear(event.date);
      if (financialYear) years.add(financialYear);
    }
  }
  return [...years].sort(
    (left, right) =>
      (financialYearStart(right) ?? 0) - (financialYearStart(left) ?? 0)
  );
}

function csvCell(value: string | number | boolean | null): string {
  let text = value === null ? "" : String(value);
  if (/^[\s]*[=+@\-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function currentAdelaideDate(): string {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Adelaide",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find(entry => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function invoicesAnnualCsv(
  records: readonly InvoiceRecord[],
  financialYear: string,
  includeHistory = false,
  asOfDate = currentAdelaideDate()
): string {
  const startYear = financialYearStart(financialYear);
  if (startYear === null) return "";
  const start = `${startYear}-07-01`;
  const end = `${startYear + 1}-06-30`;
  const header = [
    "financial_year",
    "invoice_number",
    "revision",
    "is_current_version",
    "record_status",
    "issue_date",
    "issued_at",
    "due_date",
    "supplier_name",
    "supplier_address",
    "supplier_abn",
    "customer_name",
    "customer_address",
    "customer_abn",
    "job_reference",
    "gst_mode",
    "line_id",
    "description",
    "quantity",
    "unit_price_aud",
    "line_total_aud",
    "subtotal_aud",
    "gst_aud",
    "total_aud",
    "correction_reason",
    "voided_at",
    "void_reason",
    "summary_as_of_date",
    "payment_state",
    "payments_received_to_date_aud",
    "balance_due_aud",
    "credit_due_aud",
    "delivery_state",
    "last_delivery_date",
    "delivery_attempt_count",
  ];
  const rows = [header.map(csvCell).join(",")];
  for (const record of records) {
    if (!record.versions.length) continue;
    if (record.status === "void" && !includeHistory) continue;
    const versions = includeHistory
      ? record.versions
      : [record.versions[record.versions.length - 1]];
    for (const version of versions) {
      if (version.issueDate < start || version.issueDate > end) continue;
      const isCurrent = version.version === record.versions.length;
      const paymentSummary = isCurrent ? invoicePaymentSummary(record) : null;
      const paymentState = isCurrent
        ? invoicePaymentState(record, asOfDate)
        : null;
      const deliveryState = isCurrent ? invoiceDeliveryState(record) : null;
      const currentDeliveryEvents = isCurrent
        ? (record.deliveryEvents ?? []).filter(
            event => event.version === version.version
          )
        : [];
      for (const [lineIndex, line] of version.lines.entries()) {
        const lineTotalCents = Math.round(
          (line.quantityMilli * line.unitPriceCents) / 1000
        );
        const firstLine = lineIndex === 0;
        const values: (string | number | boolean | null)[] = [
          australianFinancialYear(version.issueDate),
          version.invoiceNumber,
          version.version,
          isCurrent,
          record.status,
          version.issueDate,
          version.issuedAt,
          version.dueDate,
          version.supplierName,
          version.supplierAddress,
          version.supplierAbn,
          version.customerName,
          version.customerAddress,
          version.customerAbn,
          version.jobReference ?? "",
          version.gstMode,
          line.id,
          line.description,
          line.quantityMilli / 1000,
          (line.unitPriceCents / 100).toFixed(2),
          (lineTotalCents / 100).toFixed(2),
          firstLine ? (version.subtotalCents / 100).toFixed(2) : null,
          firstLine ? (version.gstCents / 100).toFixed(2) : null,
          firstLine ? (version.totalCents / 100).toFixed(2) : null,
          version.correctionReason,
          record.voidedAt,
          record.voidReason,
          firstLine && isCurrent ? asOfDate : null,
          firstLine && isCurrent ? (paymentState ?? "not applicable") : null,
          firstLine && paymentSummary
            ? (paymentSummary.receivedCents / 100).toFixed(2)
            : null,
          firstLine && paymentSummary
            ? (paymentSummary.balanceDueCents / 100).toFixed(2)
            : null,
          firstLine && paymentSummary
            ? (paymentSummary.creditDueCents / 100).toFixed(2)
            : null,
          firstLine && isCurrent ? (deliveryState ?? "not applicable") : null,
          firstLine && isCurrent
            ? (currentDeliveryEvents.at(-1)?.date ?? null)
            : null,
          firstLine && isCurrent ? currentDeliveryEvents.length : null,
        ];
        rows.push(values.map(csvCell).join(","));
      }
    }
  }
  return `\uFEFF${rows.join("\r\n")}\r\n`;
}
