import { isDate } from "./time";
import type {
  CredentialRenewal,
  CredentialRenewalInput,
  Workspace,
} from "./types";

export const CREDENTIAL_RENEWAL_CATEGORIES = [
  "licence",
  "professional-registration",
  "certificate",
  "permit",
  "identity-document",
  "other-credential",
] as const satisfies readonly CredentialRenewal["category"][];

export const MAX_CREDENTIAL_RENEWALS = 500;
export const MAX_CREDENTIAL_RENEWAL_NAME_LENGTH = 120;
export const MAX_CREDENTIAL_RENEWAL_PURPOSE_LENGTH = 240;
export const MAX_CREDENTIAL_RENEWAL_NOTES_LENGTH = 1500;

const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const LEGACY_KEYS = [
  "id",
  "category",
  "renewalDate",
  "createdAt",
  "updatedAt",
] as const;
const CURRENT_KEYS = [...LEGACY_KEYS, "name", "purpose", "notes"] as const;
const INPUT_KEYS = [
  "category",
  "renewalDate",
  "name",
  "purpose",
  "notes",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    value.trim().length > 0 &&
    !Number.isNaN(Date.parse(value))
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length && keys.every(key => expected.includes(key))
  );
}

export function credentialRenewalsField(value: unknown): CredentialRenewal[] {
  if (!Array.isArray(value) || value.length > MAX_CREDENTIAL_RENEWALS) {
    throw new Error(
      `Credential renewals must be a list of at most ${MAX_CREDENTIAL_RENEWALS} records.`
    );
  }
  const ids = new Set<string>();
  return value.map((raw, index) => {
    const label = `credential renewal ${index + 1}`;
    if (!isRecord(raw)) throw new Error(`${label} must be an object.`);
    const legacy = hasExactKeys(raw, LEGACY_KEYS);
    const current = hasExactKeys(raw, CURRENT_KEYS);
    if (!legacy && !current) {
      throw new Error(`${label} contains unsupported fields.`);
    }
    if (typeof raw.id !== "string" || !ID.test(raw.id) || ids.has(raw.id)) {
      throw new Error(`${label} has an invalid or duplicate ID.`);
    }
    if (
      !CREDENTIAL_RENEWAL_CATEGORIES.includes(
        raw.category as CredentialRenewal["category"]
      )
    ) {
      throw new Error(`${label} has an unsupported generic category.`);
    }
    if (typeof raw.renewalDate !== "string" || !isDate(raw.renewalDate)) {
      throw new Error(
        `${label} must have a valid YYYY-MM-DD Adelaide calendar date.`
      );
    }
    if (!validTimestamp(raw.createdAt) || !validTimestamp(raw.updatedAt)) {
      throw new Error(`${label} timestamps must be valid dates.`);
    }
    ids.add(raw.id);

    if (!current) {
      return {
        id: raw.id,
        category: raw.category as CredentialRenewal["category"],
        renewalDate: raw.renewalDate,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      };
    }

    const normalized = normalizeCredentialRenewalInput({
      category: raw.category as CredentialRenewal["category"],
      renewalDate: raw.renewalDate,
      name: raw.name as string,
      purpose: raw.purpose as string,
      notes: raw.notes as string,
    });
    if (!normalized) {
      throw new Error(`${label} has an invalid name, purpose, or notes field.`);
    }
    return {
      id: raw.id,
      ...normalized,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  });
}

export function normalizeCredentialRenewalInput(
  input: CredentialRenewalInput
): CredentialRenewalInput | null {
  const value: unknown = input;
  if (!isRecord(value) || !hasExactKeys(value, INPUT_KEYS)) return null;
  const category = value.category;
  const renewalDate = value.renewalDate;
  const nameInput = value.name;
  const purposeInput = value.purpose;
  const notesInput = value.notes;
  if (
    typeof category !== "string" ||
    !CREDENTIAL_RENEWAL_CATEGORIES.includes(
      category as CredentialRenewal["category"]
    ) ||
    typeof renewalDate !== "string" ||
    !isDate(renewalDate) ||
    typeof nameInput !== "string" ||
    typeof purposeInput !== "string" ||
    typeof notesInput !== "string"
  ) {
    return null;
  }
  const name = nameInput.trim();
  const purpose = purposeInput.trim();
  const notes = notesInput.trim();
  if (
    name.length < 1 ||
    name.length > MAX_CREDENTIAL_RENEWAL_NAME_LENGTH ||
    purpose.length > MAX_CREDENTIAL_RENEWAL_PURPOSE_LENGTH ||
    notes.length > MAX_CREDENTIAL_RENEWAL_NOTES_LENGTH
  ) {
    return null;
  }
  return {
    category: category as CredentialRenewalInput["category"],
    renewalDate,
    name,
    purpose,
    notes,
  };
}

export function createCredentialRenewal(
  workspace: Workspace,
  input: CredentialRenewalInput,
  id: string,
  at: string
): Workspace {
  const normalized = normalizeCredentialRenewalInput(input);
  const records = workspace.credentialRenewals ?? [];
  if (
    !normalized ||
    !ID.test(id) ||
    !validTimestamp(at) ||
    records.length >= MAX_CREDENTIAL_RENEWALS ||
    records.some(record => record.id === id)
  ) {
    return workspace;
  }
  const record: CredentialRenewal = {
    id,
    ...normalized,
    createdAt: at,
    updatedAt: at,
  };
  return { ...workspace, credentialRenewals: [...records, record] };
}

export function updateCredentialRenewal(
  workspace: Workspace,
  id: string,
  input: CredentialRenewalInput,
  at: string
): Workspace {
  const normalized = normalizeCredentialRenewalInput(input);
  const records = workspace.credentialRenewals ?? [];
  if (
    !normalized ||
    !validTimestamp(at) ||
    !records.some(item => item.id === id)
  ) {
    return workspace;
  }
  return {
    ...workspace,
    credentialRenewals: records.map(record =>
      record.id === id ? { ...record, ...normalized, updatedAt: at } : record
    ),
  };
}

export function deleteCredentialRenewal(
  workspace: Workspace,
  id: string
): Workspace {
  const records = workspace.credentialRenewals ?? [];
  if (!records.some(record => record.id === id)) return workspace;
  return {
    ...workspace,
    credentialRenewals: records.filter(record => record.id !== id),
  };
}
