import { describe, expect, it } from "vitest";
import {
  createCredentialRenewal,
  credentialRenewalsField,
  deleteCredentialRenewal,
  MAX_CREDENTIAL_RENEWAL_NAME_LENGTH,
  MAX_CREDENTIAL_RENEWAL_NOTES_LENGTH,
  MAX_CREDENTIAL_RENEWAL_PURPOSE_LENGTH,
  normalizeCredentialRenewalInput,
  updateCredentialRenewal,
} from "./credentialRenewals";
import type { CredentialRenewalInput, Workspace } from "./types";

const STAMP = "2026-10-31T10:00:00+10:30";

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
    trial: { startedAt: STAMP, lastExportAt: null, lastReviewAt: null },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [],
    reviews: [],
    goals: [],
  };
}

const input = {
  category: "professional-registration" as const,
  renewalDate: "2027-03-15",
  name: " Work licence ",
  purpose: " Used for site access ",
  notes: "Renew through the training portal.\nCheck course dates.",
};
const normalized = {
  category: "professional-registration" as const,
  renewalDate: "2027-03-15",
  name: "Work licence",
  purpose: "Used for site access",
  notes: "Renew through the training portal.\nCheck course dates.",
};
const record = {
  id: "renewal-one",
  ...normalized,
  createdAt: STAMP,
  updatedAt: STAMP,
};
const legacyRecord = {
  id: "renewal-legacy",
  category: "professional-registration" as const,
  renewalDate: "2027-03-15",
  createdAt: STAMP,
  updatedAt: STAMP,
};

describe("credential renewals with non-secret descriptive metadata", () => {
  it("normalizes a generic category, valid Adelaide date and bounded editable text", () => {
    expect(normalizeCredentialRenewalInput(input)).toEqual(normalized);
    expect(
      normalizeCredentialRenewalInput({
        ...normalized,
        unexpectedField: "synthetic",
      } as CredentialRenewalInput)
    ).toBeNull();
    expect(
      normalizeCredentialRenewalInput({
        ...normalized,
        renewalDate: "2027-02-30",
      })
    ).toBeNull();
    expect(
      normalizeCredentialRenewalInput({
        ...normalized,
        category: "passport" as never,
      })
    ).toBeNull();
    expect(
      normalizeCredentialRenewalInput({ ...normalized, name: "   " })
    ).toBeNull();
  });

  it("rejects overlong name, purpose and notes", () => {
    expect(
      normalizeCredentialRenewalInput({
        ...normalized,
        name: "n".repeat(MAX_CREDENTIAL_RENEWAL_NAME_LENGTH + 1),
      })
    ).toBeNull();
    expect(
      normalizeCredentialRenewalInput({
        ...normalized,
        purpose: "p".repeat(MAX_CREDENTIAL_RENEWAL_PURPOSE_LENGTH + 1),
      })
    ).toBeNull();
    expect(
      normalizeCredentialRenewalInput({
        ...normalized,
        notes: "n".repeat(MAX_CREDENTIAL_RENEWAL_NOTES_LENGTH + 1),
      })
    ).toBeNull();
  });

  it("accepts old date-only backups but rejects unsupported identity/secret fields", () => {
    expect(credentialRenewalsField([legacyRecord])).toEqual([legacyRecord]);
    expect(credentialRenewalsField([record])).toEqual([record]);
    expect(() =>
      credentialRenewalsField([{ ...record, accountNumber: "synthetic" }])
    ).toThrow(/unsupported fields/i);
    expect(() =>
      credentialRenewalsField([{ ...record, password: "synthetic" }])
    ).toThrow(/unsupported fields/i);
    expect(() =>
      credentialRenewalsField([{ ...record, renewalDate: "2027-02-30" }])
    ).toThrow(/calendar date/i);
    expect(() => credentialRenewalsField([record, record])).toThrow(
      /duplicate ID/i
    );
  });

  it("creates, edits and deletes only the record, leaving tasks untouched", () => {
    const source = workspace();
    const created = createCredentialRenewal(source, input, record.id, STAMP);
    expect(created.credentialRenewals).toEqual([record]);
    expect(created.tasks).toBe(source.tasks);

    const editedInput = {
      category: "certificate" as const,
      renewalDate: "2027-04-01",
      name: "First aid certificate",
      purpose: "Workplace training renewal",
      notes: "Ask about upcoming sessions.",
    };
    const edited = updateCredentialRenewal(
      created,
      record.id,
      editedInput,
      "2026-11-01T09:00:00+10:30"
    );
    expect(edited.credentialRenewals?.[0]).toMatchObject({
      id: record.id,
      ...editedInput,
      createdAt: STAMP,
    });
    expect(edited.tasks).toBe(source.tasks);

    const removed = deleteCredentialRenewal(edited, record.id);
    expect(removed.credentialRenewals).toEqual([]);
    expect(removed.tasks).toBe(source.tasks);
  });

  it("fails closed on invalid inputs, timestamps, IDs and missing records", () => {
    const source = workspace();
    expect(
      createCredentialRenewal(
        source,
        { ...normalized, renewalDate: "2027-02-30" },
        record.id,
        STAMP
      )
    ).toBe(source);
    expect(
      createCredentialRenewal(source, input, "bad id with spaces", STAMP)
    ).toBe(source);
    expect(
      updateCredentialRenewal(
        source,
        "missing",
        { ...normalized, category: "licence" },
        STAMP
      )
    ).toBe(source);
    expect(deleteCredentialRenewal(source, "missing")).toBe(source);
  });
});
