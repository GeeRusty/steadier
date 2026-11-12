import { describe, expect, it } from "vitest";
import { safeAmount, safeShortText, scrubSensitive } from "../../shared/safeFields";

const BILL = `AGL Energy
Electricity bill
John Citizen
Unit 2/14 Smith Street
ADELAIDE SA 5000
Account number: 1234 5678 90
Invoice No. 99887766
BSB 062-000  Acc 12345678
Biller code: 23796  Ref: 4455 6677 8899
Amount due $1,234.56
Due date 28/11/2026
Billing period 1 Oct 2026 to 31 Oct 2026
Card ending 4242
Email john@example.com
Password: hunter2
Call 1300 123 456
Next bill around 2026-12-28. Pay monthly.`;

describe("never-store filter", () => {
  const { text, removed } = scrubSensitive(BILL);

  it("removes account, card, BSB and reference numbers", () => {
    for (const secret of ["1234 5678 90", "99887766", "062-000", "12345678", "23796", "4455 6677 8899", "4242"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("removes sign-ins, emails and the street address", () => {
    for (const secret of ["hunter2", "john@example.com", "Smith Street", "14", "ADELAIDE SA 5000"]) {
      expect(text).not.toMatch(new RegExp(`\\b${secret}\\b`));
    }
    expect(removed).toBeGreaterThanOrEqual(10);
  });

  it("keeps the provider, amount and dates", () => {
    expect(text).toContain("AGL Energy");
    expect(text).toContain("Electricity bill");
    expect(text).toContain("$1,234.56");
    expect(text).toContain("28/11/2026");
    expect(text).toContain("2026-12-28");
    expect(text).toContain("1 Oct 2026 to 31 Oct 2026");
    expect(text).toContain("Pay monthly");
  });

  it("cleans short fields and counts what it removed", () => {
    expect(safeShortText("Telstra — mobile, account 99887766")).toEqual({ text: "Telstra — mobile", removed: 1 });
    expect(safeShortText("Netflix")).toEqual({ text: "Netflix", removed: 0 });
    expect(safeShortText(42)).toEqual({ text: "", removed: 0 });
  });

  it("only a plain money amount survives", () => {
    expect(safeAmount("$1,234.56")).toBe("$1,234.56");
    expect(safeAmount("12")).toBe("$12.00");
    expect(safeAmount("AUD 19.9")).toBe("$19.90");
    expect(safeAmount("abc")).toBeNull();
    expect(safeAmount("1234 5678 9012 3456")).toBeNull();
    expect(safeAmount("12345678")).toBeNull();
    expect(safeAmount("0")).toBeNull();
  });
});
