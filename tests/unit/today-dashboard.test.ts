import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lesson } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  getBusinessSettings: vi.fn(),
  getLessons: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/data", () => mocks);

import { getTimezoneAwareTodayDashboard } from "@/lib/timezone-data";

function lesson(overrides: Partial<Lesson>): Lesson {
  return {
    id: crypto.randomUUID(),
    studentId: "11111111-1111-4111-8111-111111111111",
    studentName: "Student",
    startsAt: "2026-09-05T07:00:00.000Z",
    durationMinutes: 60,
    rateCents: 10000,
    status: "attended",
    billingOverride: "default",
    notes: "",
    version: 1,
    syncRevision: 1,
    ...overrides,
  };
}

describe("today dashboard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T10:00:00.000Z"));
    mocks.getBusinessSettings.mockResolvedValue({ timezone: "Africa/Johannesburg" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("includes invoiced billable lessons in monthly earnings and counts only attended lessons as completed", async () => {
    mocks.getLessons.mockResolvedValue([
      lesson({ rateCents: 10000 }),
      lesson({ rateCents: 20000, invoiced: true }),
      lesson({ rateCents: 30000, status: "no_show" }),
      lesson({ rateCents: 40000, status: "canceled_rescheduled" }),
    ]);

    const dashboard = await getTimezoneAwareTodayDashboard();

    expect(dashboard.monthEarnings).toBe(60000);
    expect(dashboard.completedCount).toBe(2);
    expect(dashboard.billableCount).toBe(3);
  });
});
