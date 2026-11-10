import { describe, expect, it } from "vitest";
import { systemRisk } from "../components/steadier/TodayHeader";

const base = {
  personal: true,
  hasData: true,
  lastExportAt: new Date().toISOString(),
  cloudActive: true,
  status: "saved" as never,
  storageError: null,
};

describe("system risk banner", () => {
  it("offers Choose, not Back up, when the shared workspace has a conflict", () => {
    const risk = systemRisk({
      ...base,
      status: "conflict" as never,
      storageError:
        "Another device or tab changed this workspace. Both versions are preserved; choose which version to keep.",
    });
    expect(risk).toMatchObject({ kind: "sync", action: "Choose" });
  });

  it("keeps sync failures as Fix and genuine browser storage errors as Back up", () => {
    expect(
      systemRisk({ ...base, status: "error" as never, storageError: "Offline" })
    ).toMatchObject({ kind: "sync", action: "Fix" });
    expect(
      systemRisk({
        ...base,
        cloudActive: false,
        status: "local" as never,
        storageError: "Browser refused to store",
      })
    ).toMatchObject({ kind: "storage", action: "Back up" });
  });
});
