import { describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { buildSeriesReplacement, expandSeries } from "@/lib/recurrence";

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

  it("keeps local lesson time through a daylight-saving change", () => {
    const replacement = buildSeriesReplacement(
      {
        startsAtLocal: "2026-02-23T09:00",
        timezone: "America/New_York",
        frequency: "weekly",
        weekdays: [1],
        until: "2026-03-31",
        exclusions: [],
      },
      new Date("2026-03-02T14:00:00.000Z"),
      "2026-03-03T09:00",
      new Date("2026-03-02T14:00:00.000Z"),
      new Date("2026-03-31T23:00:00.000Z"),
    );

    expect(replacement.weekdays).toEqual([2]);
    expect(replacement.occurrences.slice(0, 3).map(({ startsAt }) =>
      formatInTimeZone(startsAt, "America/New_York", "yyyy-MM-dd HH:mm"),
    )).toEqual(["2026-03-03 09:00", "2026-03-10 09:00", "2026-03-17 09:00"]);
    expect(replacement.occurrences.slice(0, 3).map(({ startsAt }) => startsAt)).toEqual([
      "2026-03-03T14:00:00.000Z",
      "2026-03-10T13:00:00.000Z",
      "2026-03-17T13:00:00.000Z",
    ]);
  });

  it("keeps explicit end and exclusion dates when weekdays move", () => {
    const replacement = buildSeriesReplacement(
      {
        startsAtLocal: "2026-09-07T15:30",
        timezone: "Africa/Johannesburg",
        frequency: "weekly",
        weekdays: [1, 3],
        until: "2026-09-30",
        exclusions: ["2026-09-14", "2026-09-17"],
      },
      new Date("2026-09-07T13:30:00.000Z"),
      "2026-09-08T15:30",
      new Date("2026-09-07T13:30:00.000Z"),
      new Date("2026-10-10T00:00:00.000Z"),
    );

    expect(replacement.until).toBe("2026-09-30");
    expect(replacement.exclusions).toEqual(["2026-09-14", "2026-09-17"]);
    expect(replacement.occurrences.map(({ sourceKey, startsAt }) => [
      formatInTimeZone(sourceKey, "Africa/Johannesburg", "yyyy-MM-dd"),
      formatInTimeZone(startsAt, "Africa/Johannesburg", "yyyy-MM-dd"),
    ])).toEqual([
      ["2026-09-07", "2026-09-08"],
      ["2026-09-09", "2026-09-10"],
      ["2026-09-14", "2026-09-15"],
      ["2026-09-21", "2026-09-22"],
      ["2026-09-23", "2026-09-24"],
      ["2026-09-28", "2026-09-29"],
    ]);
  });

  it("includes a selected lesson moved earlier than its original cutoff", () => {
    const replacement = buildSeriesReplacement(
      {
        startsAtLocal: "2026-09-01T10:00",
        timezone: "Africa/Johannesburg",
        frequency: "weekly",
        weekdays: [2],
        until: "2026-10-31",
        exclusions: [],
      },
      new Date("2026-09-15T08:00:00.000Z"),
      "2026-09-14T10:00",
      new Date("2026-09-15T08:00:00.000Z"),
      new Date("2026-10-31T22:00:00.000Z"),
    );

    expect(formatInTimeZone(replacement.occurrences[0].startsAt, "Africa/Johannesburg", "yyyy-MM-dd HH:mm"))
      .toBe("2026-09-14 10:00");
  });

  it("preserves a multi-day fortnightly cadence across the week boundary", () => {
    const replacement = buildSeriesReplacement(
      {
        startsAtLocal: "2026-09-07T10:00",
        timezone: "Africa/Johannesburg",
        frequency: "fortnightly",
        weekdays: [1, 3],
        weekStartsOn: 1,
        until: "2026-10-31",
        exclusions: [],
      },
      new Date("2026-09-07T08:00:00.000Z"),
      "2026-09-12T10:00",
      new Date("2026-09-07T08:00:00.000Z"),
      new Date("2026-10-31T22:00:00.000Z"),
    );

    expect(replacement.weekdays).toEqual([6, 1]);
    expect(replacement.weekStartsOn).toBe(6);
    expect(replacement.occurrences.slice(0, 6).map(({ startsAt }) =>
      formatInTimeZone(startsAt, "Africa/Johannesburg", "yyyy-MM-dd"),
    )).toEqual([
      "2026-09-12",
      "2026-09-14",
      "2026-09-26",
      "2026-09-28",
      "2026-10-10",
      "2026-10-12",
    ]);
  });

  it("uses the shifted week boundary when extending a fortnightly series", () => {
    const dates = expandSeries({
      startsAtLocal: "2027-01-03T10:00",
      timezone: "UTC",
      frequency: "fortnightly",
      weekdays: [0, 6],
      weekStartsOn: 0,
      until: "2027-01-31",
    });

    expect(dates.map((date) => date.toISOString().slice(0, 10))).toEqual([
      "2027-01-03",
      "2027-01-09",
      "2027-01-17",
      "2027-01-23",
      "2027-01-31",
    ]);
  });

  it("skips a local time that does not exist at the DST transition", () => {
    const dates = expandSeries({
      startsAtLocal: "2027-03-07T02:30",
      timezone: "America/New_York",
      frequency: "weekly",
      weekdays: [0],
      until: "2027-03-21",
    });

    expect(dates.map((date) => formatInTimeZone(date, "America/New_York", "yyyy-MM-dd HH:mm")))
      .toEqual(["2027-03-07 02:30", "2027-03-21 02:30"]);
  });
});
