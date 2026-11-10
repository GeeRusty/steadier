import { describe, expect, it } from "vitest";
import { exportBackup, parseBackup, validateWorkspace } from "./transfer";
import {
  isCanonicalPublicHttpsUrl,
  normalizePublicHttpsUrl,
  saveSiteCard,
  setSiteCardStatus,
} from "./siteCards";
import type { Workspace } from "./types";

const STAMP = "2026-10-30T11:00:00+10:30";

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
    trial: { startedAt: STAMP, lastExportAt: null, lastReviewAt: null },
    planning: { dayStart: "08:00", dayEnd: "18:00", bufferMinutes: 10 },
    imperatives: [],
    reviews: [],
    goals: [],
  };
}

const input = {
  title: "Council rates",
  category: "Government",
  purpose: "Check the next due date.",
  url: "https://example.gov.au/rates",
};

describe("Site Cards", () => {
  it("accepts only canonical public HTTPS links without embedded access material", () => {
    expect(normalizePublicHttpsUrl("https://example.com/path")).toBe(
      "https://example.com/path"
    );
    expect(isCanonicalPublicHttpsUrl("https://example.com/path")).toBe(true);
    for (const value of [
      "http://example.com",
      "javascript:alert(1)",
      "https://user:password@example.com",
      "https://example.com/?token=secret",
      "https://example.com/#private",
      "https://localhost/admin",
      "https://192.168.1.4",
    ]) {
      expect(normalizePublicHttpsUrl(value)).toBeNull();
    }
  });

  it("requires explicit save, preserves task data, and supports reversible archive", () => {
    const source = emptyWorkspace();
    const saved = saveSiteCard(source, input, "site-1", STAMP);
    expect(source.siteCards).toBeUndefined();
    expect(saved.tasks).toEqual([]);
    expect(saved.siteCards).toEqual([
      {
        id: "site-1",
        title: "Council rates",
        category: "Government",
        purpose: "Check the next due date.",
        url: "https://example.gov.au/rates",
        status: "active",
        createdAt: STAMP,
        updatedAt: STAMP,
      },
    ]);
    const archived = setSiteCardStatus(saved, "site-1", "archived", STAMP);
    expect(archived.siteCards?.[0].status).toBe("archived");
    expect(
      setSiteCardStatus(archived, "site-1", "active", STAMP).siteCards?.[0]
        .status
    ).toBe("active");
  });

  it("round-trips safely and rejects credentials or unknown fields on import", () => {
    const saved = saveSiteCard(emptyWorkspace(), input, "site-1", STAMP);
    expect(parseBackup(exportBackup(saved))).toEqual(saved);
    const malformed = {
      ...saved,
      siteCards: [
        { ...saved.siteCards![0], url: "https://person:secret@example.com" },
      ],
    };
    expect(() => validateWorkspace(malformed)).toThrow();
    const unknown = {
      ...saved,
      siteCards: [{ ...saved.siteCards![0], password: "must not be accepted" }],
    };
    expect(() => validateWorkspace(unknown)).toThrow();
  });
});
