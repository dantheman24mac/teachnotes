import { describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { expandSeries } from "@/lib/recurrence";

describe("recurring lesson expansion", () => {
  it("supports multiple weekdays and excluded dates", () => {
    const dates = expandSeries({
      startsAtLocal: "2026-07-06T15:30",
      timezone: "Africa/Johannesburg",
      frequency: "weekly",
      weekdays: [1, 3],
      until: "2026-07-15",
      exclusions: ["2026-07-08"],
    });
    expect(dates.map((date) => formatInTimeZone(date, "Africa/Johannesburg", "yyyy-MM-dd HH:mm"))).toEqual([
      "2026-07-06 15:30",
      "2026-07-13 15:30",
      "2026-07-15 15:30",
    ]);
  });

  it("supports fortnightly schedules", () => {
    const dates = expandSeries({ startsAtLocal: "2026-07-06T09:00", timezone: "Africa/Johannesburg", frequency: "fortnightly", weekdays: [1], until: "2026-08-10" });
    expect(dates.map((date) => formatInTimeZone(date, "Africa/Johannesburg", "yyyy-MM-dd"))).toEqual(["2026-07-06", "2026-07-20", "2026-08-03"]);
  });
});
