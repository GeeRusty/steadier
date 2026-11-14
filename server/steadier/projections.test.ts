import { newAsset } from "../../client/src/domain/assets";
import { describe, expect, it } from "vitest";
import type { Workspace } from "../../client/src/domain/types";
import { presentWorkspace, workspaceSheetCsv } from "./projections";

const evidence = {
  id: "evidence-1",
  targetKind: "task" as const,
  targetId: "task-1",
  titleSnapshot: "Private source task",
  text: "A private owner-saved observation.",
  createdAt: "2026-10-30T11:00:00+10:30",
  updatedAt: "2026-10-30T11:00:00+10:30",
};
const siteCard = {
  id: "site-1",
  title: "Private provider note",
  category: "Reference",
  purpose: "Owner-only context.",
  url: "https://example.com/",
  status: "active" as const,
  createdAt: "2026-10-30T11:00:00+10:30",
  updatedAt: "2026-10-30T11:00:00+10:30",
};
const lists = {
  templates: [
    {
      id: "list-1",
      title: "Private groceries",
      kind: "do-confirm" as const,
      useWhen: "",
      sections: [],
      items: [
        {
          id: "list-item-1",
          text: "Owner-only item",
          sectionId: null,
          suggested: false,
          createdAt: "2026-10-30T11:00:00+10:30",
          updatedAt: "2026-10-30T11:00:00+10:30",
        },
      ],
      createdAt: "2026-10-30T11:00:00+10:30",
      updatedAt: "2026-10-30T11:00:00+10:30",
    },
  ],
  runs: [],
  links: [],
};
const asset = {
  ...newAsset("asset-1", "Private vacuum", "appliance", "2026-10-30T11:00:00+10:30"),
  logs: [
    {
      id: "log-1",
      kind: "note" as const,
      date: "2026-10-30",
      reading: null,
      cost: null,
      by: "",
      notes: "Private condition note.",
      conditionAfter: "fair" as const,
      planId: null,
      taskId: null,
      createdAt: "2026-10-30T11:00:00+10:30",
      updatedAt: "2026-10-30T11:00:00+10:30",
    },
  ],
};
const person = {
  id: "person-1",
  name: "Private contact",
  relationship: "Friend",
  context: "Private follow-up context.",
  lastContactDate: "2026-10-20",
  nextContactDate: "2026-11-03",
  status: "active" as const,
  createdAt: "2026-10-30T11:00:00+10:30",
  updatedAt: "2026-10-30T11:00:00+10:30",
};
const credentialRenewal = {
  id: "renewal-1",
  category: "licence" as const,
  renewalDate: "2027-03-15",
  name: "Synthetic renewal label",
  purpose: "Synthetic purpose",
  notes: "Synthetic private note",
  createdAt: "2026-10-30T11:00:00+10:30",
  updatedAt: "2026-10-30T11:00:00+10:30",
};
const invoiceSettings = {
  supplierName: "Private synthetic business",
  supplierAddress: "Example address, Adelaide SA",
  supplierAbn: "",
  gstMode: "off" as const,
  gstConfirmedAt: null,
  gstConfirmedProfile: null,
  nextInvoiceNumber: 1,
  updatedAt: "2026-10-30T11:00:00+10:30",
};
const invoiceDraft = {
  issueDate: "2026-10-30",
  dueDate: null,
  customerName: "Private synthetic customer",
  jobReference: "Private synthetic job reference",
  customerAddress: "Example customer address",
  customerAbn: "",
  lines: [
    {
      id: "line-1",
      description: "Private synthetic work details",
      quantityMilli: 1000,
      unitPriceCents: 10000,
    },
  ],
};
const invoice = {
  id: "invoice-1",
  invoiceNumber: null,
  status: "draft" as const,
  draft: invoiceDraft,
  versions: [],
  voidedAt: null,
  voidReason: null,
  deliveryEvents: [
    {
      id: "delivery-private",
      version: 1,
      date: "2026-10-30",
      result: "sent" as const,
      note: "Private synthetic delivery note",
      recordedAt: "2026-10-30T11:00:00+10:30",
    },
  ],
  paymentEvents: [
    {
      id: "payment-private",
      kind: "payment" as const,
      reversalOf: null,
      version: 1,
      date: "2026-10-30",
      amountCents: 5000,
      note: "Private synthetic payment note",
      recordedAt: "2026-10-30T11:00:00+10:30",
    },
  ],
  createdAt: "2026-10-30T11:00:00+10:30",
  updatedAt: "2026-10-30T11:00:00+10:30",
};

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
    trial: {
      startedAt: "2026-10-30T11:00:00+10:30",
      lastExportAt: null,
      lastReviewAt: null,
    },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [],
    reviews: [],
    goals: [],
    evidence: [evidence],
    siteCards: [siteCard],
    lists,
    assets: [asset],
    people: [person],
    credentialRenewals: [credentialRenewal],
    invoiceSettings,
    invoices: [invoice],
  };
}

describe("connector-safe workspace projection", () => {
  it("excludes owner-only Evidence, Site Card, Shopping List, Asset, People, credential and invoice data without changing stored Workspace", () => {
    const source = workspace();
    const originalEvidence = structuredClone(source.evidence);
    const originalSiteCards = structuredClone(source.siteCards);
    const originalShoppingLists = structuredClone(source.lists);
    const originalAssets = structuredClone(source.assets);
    const originalPeople = structuredClone(source.people);
    const originalCredentialRenewals = structuredClone(
      source.credentialRenewals
    );
    const originalInvoiceSettings = structuredClone(source.invoiceSettings);
    const originalInvoices = structuredClone(source.invoices);
    const presented = presentWorkspace(source);
    expect(presented.evidence).toBeUndefined();
    expect(presented.siteCards).toBeUndefined();
    expect(presented.lists).toBeUndefined();
    expect(presented.assets).toBeUndefined();
    expect(presented.people).toBeUndefined();
    expect(presented.credentialRenewals).toBeUndefined();
    expect(presented.invoiceSettings).toBeUndefined();
    expect(presented.invoices).toBeUndefined();
    expect(source.evidence).toEqual(originalEvidence);
    expect(source.siteCards).toEqual(originalSiteCards);
    expect(source.lists).toEqual(originalShoppingLists);
    expect(source.assets).toEqual(originalAssets);
    expect(source.people).toEqual(originalPeople);
    expect(source.credentialRenewals).toEqual(originalCredentialRenewals);
    expect(source.invoiceSettings).toEqual(originalInvoiceSettings);
    expect(source.invoices).toEqual(originalInvoices);
    expect(presented.tasks).toEqual([]);
    expect(presented.projects).toEqual([]);

    const csv = workspaceSheetCsv(
      {
        workspace: source,
        revision: 1,
        updatedAt: "2026-10-30T11:00:00+10:30",
        timeZone: "Australia/Adelaide",
        focusOwnerClientId: null,
      },
      new Date("2026-10-31T12:00:00+10:30")
    );
    expect(JSON.stringify(presented)).not.toContain(
      "Private synthetic job reference"
    );
    expect(JSON.stringify(presented)).not.toContain(
      "Private synthetic delivery note"
    );
    expect(JSON.stringify(presented)).not.toContain(
      "Private synthetic payment note"
    );
    expect(csv).not.toContain("Private synthetic job reference");
    expect(csv).not.toContain("Private synthetic delivery note");
    expect(csv).not.toContain("Private synthetic payment note");
    expect(csv).not.toContain("Synthetic renewal label");
    expect(csv).not.toContain("Synthetic purpose");
    expect(csv).not.toContain("Synthetic private note");
    expect(csv).not.toContain(credentialRenewal.renewalDate);
  });
});
