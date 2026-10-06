import { describe, expect, it } from "vitest";
import {
  calculateBillableTotal,
  calculateInvoiceTotal,
  formatZar,
  getInvoiceEligibleLessons,
  invoiceNumber,
  isBillable,
} from "@/lib/domain";

describe("lesson billing", () => {
  it("uses status defaults and explicit overrides", () => {
    expect(isBillable("attended", "default")).toBe(true);
    expect(isBillable("no_show", "default")).toBe(true);
    expect(isBillable("canceled_rescheduled", "default")).toBe(false);
    expect(isBillable("canceled_rescheduled", "billable")).toBe(true);
    expect(isBillable("attended", "non_billable")).toBe(false);
  });

  it("charges a fixed lesson amount without duration proration", () => {
    expect(calculateInvoiceTotal([
      { status: "attended", billingOverride: "default", rateCents: 45000 },
      { status: "no_show", billingOverride: "default", rateCents: 38000 },
      { status: "canceled_rescheduled", billingOverride: "default", rateCents: 28000 },
      { status: "attended", billingOverride: "default", rateCents: 45000, invoiced: true },
    ])).toBe(83000);
  });

  it("counts invoiced lessons in billable earnings but excludes them from invoice totals", () => {
    const lessons = [
      { status: "attended" as const, billingOverride: "default" as const, rateCents: 45000 },
      { status: "no_show" as const, billingOverride: "default" as const, rateCents: 38000, invoiced: true },
      { status: "canceled_rescheduled" as const, billingOverride: "default" as const, rateCents: 28000 },
    ];

    expect(calculateBillableTotal(lessons)).toBe(83000);
    expect(calculateInvoiceTotal(lessons)).toBe(45000);
    expect(getInvoiceEligibleLessons(lessons)).toEqual([lessons[0]]);
  });

  it("formats ZAR and sequential invoice numbers", () => {
    expect(formatZar(123456)).toContain("1 234,56");
    expect(invoiceNumber("INV", 2026, 7)).toBe("INV-2026-0007");
  });
});
