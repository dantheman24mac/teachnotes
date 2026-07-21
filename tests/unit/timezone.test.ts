import { describe, expect, it } from "vitest";
import {
  formatDateTimeLocalValue,
  formatInWorkspaceTime,
  getWorkspaceDateKey,
  getWorkspaceDayBounds,
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
});
