import { RRule, datetime } from "rrule";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

const weekdayMap = [
  RRule.SU,
  RRule.MO,
  RRule.TU,
  RRule.WE,
  RRule.TH,
  RRule.FR,
  RRule.SA,
];

export interface RecurrenceInput {
  startsAtLocal: string;
  timezone: string;
  frequency: "weekly" | "fortnightly";
  weekdays: number[];
  until?: string | null;
  exclusions?: string[];
  horizon?: Date;
}

export function expandSeries(input: RecurrenceInput): Date[] {
  const [localDate, localTime = "00:00"] = input.startsAtLocal.split("T");
  const [year, month, day] = localDate.split("-").map(Number);
  const [hour, minute] = localTime.split(":").map(Number);
  const start = datetime(year, month, day, hour, minute);
  const horizonDate = input.horizon ?? new Date(fromZonedTime(input.startsAtLocal, input.timezone).getTime() + 366 * 24 * 60 * 60 * 1000);
  const horizonLocal = formatInTimeZone(horizonDate, input.timezone, "yyyy-MM-dd'T'HH:mm:ss");
  const [horizonDay, horizonTime] = horizonLocal.split("T");
  const [horizonYear, horizonMonth, horizonDateOfMonth] = horizonDay.split("-").map(Number);
  const [horizonHour, horizonMinute, horizonSecond] = horizonTime.split(":").map(Number);
  const until = input.until
    ? datetime(...(input.until.split("-").map(Number) as [number, number, number]), 23, 59, 59)
    : datetime(horizonYear, horizonMonth, horizonDateOfMonth, horizonHour, horizonMinute, horizonSecond);
  const excluded = new Set(input.exclusions ?? []);
  const rule = new RRule({
    freq: RRule.WEEKLY,
    interval: input.frequency === "fortnightly" ? 2 : 1,
    dtstart: start,
    until,
    byweekday: input.weekdays.map((day) => weekdayMap[day]),
  });

  return rule
    .all()
    .map((date) => fromZonedTime(date.toISOString().slice(0, 19), input.timezone))
    .filter((date) => !excluded.has(formatInTimeZone(date, input.timezone, "yyyy-MM-dd")));
}
