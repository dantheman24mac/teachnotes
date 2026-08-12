import { describe, expect, it } from "vitest";
import {
  formatDateTimeLocalValue,
  formatInWorkspaceTime,
  getWorkspaceDateKey,
  getWorkspaceDayBounds,
  getWorkspaceInvoicePeriod,
  getWorkspaceMonthBounds,
} from "@/lib/timezone";

const timezone = "Africa/Johannesburg";

describe("workspace timezone helpers", () => {
  it("renders stored UTC instants in the workspace timezone", () => {
    const stored = "2026-07-20T13:00:00.000Z";
    expect(formatInWorkspaceTime(stored, timezone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })).toBe("15:00");
    expect(formatDateTimeLocalValue(stored, timezone)).toBe("2026-07-20T15:00");
  });

  it("uses local calendar dates and UTC boundaries for Johannesburg", () => {
    const lateUtc = "2026-07-20T22:30:00.000Z";
    expect(getWorkspaceDateKey(lateUtc, timezone)).toBe("2026-07-21");
    const day = getWorkspaceDayBounds(lateUtc, timezone);
    expect(day.start.toISOString()).toBe("2026-07-20T22:00:00.000Z");
    expect(day.end.toISOString()).toBe("2026-07-21T22:00:00.000Z");
  });

  it("builds month boundaries without relying on the server timezone", () => {
    const month = getWorkspaceMonthBounds("2026-07", timezone);
    expect(month.start.toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(month.end.toISOString()).toBe("2026-07-31T22:00:00.000Z");
  });

  it("builds inclusive invoice periods from workspace months while the server uses UTC", () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      const july = getWorkspaceInvoicePeriod("2026-07", timezone);
      const august = getWorkspaceInvoicePeriod("2026-08", timezone);
      expect(july.start.toISOString()).toBe("2026-06-30T22:00:00.000Z");
      expect(july.end.toISOString()).toBe("2026-07-31T21:59:59.999Z");
      expect(august.start.toISOString()).toBe("2026-07-31T22:00:00.000Z");
      expect(august.end.toISOString()).toBe("2026-08-31T21:59:59.999Z");

      const augustFirst = new Date("2026-07-31T22:30:00.000Z");
      const julyLast = new Date("2026-07-31T21:59:59.999Z");
      const septemberFirst = new Date("2026-08-31T22:00:00.000Z");
      expect(augustFirst >= august.start && augustFirst <= august.end).toBe(true);
      expect(augustFirst <= july.end).toBe(false);
      expect(julyLast >= july.start && julyLast <= july.end).toBe(true);
      expect(septemberFirst <= august.end).toBe(false);
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it("supports UTC workspaces without changing the period contract", () => {
    const august = getWorkspaceInvoicePeriod("2026-08", "UTC");
    expect(august.start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(august.end.toISOString()).toBe("2026-08-31T23:59:59.999Z");
  });
});
