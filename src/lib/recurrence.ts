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
  weekStartsOn?: number;
  until?: string | null;
  exclusions?: string[];
  horizon?: Date;
}

export interface SeriesReplacement {
  startsAtLocal: string;
  timezone: string;
  frequency: "weekly" | "fortnightly";
  weekdays: number[];
  weekStartsOn: number;
  until: string | null;
  exclusions: string[];
  occurrences: Array<{ sourceKey: string; startsAt: string }>;
}

const localTimestampPattern = "yyyy-MM-dd'T'HH:mm:ss";

function localMilliseconds(value: string) {
  return Date.parse(`${value.replace(" ", "T").slice(0, 19)}Z`);
}

function shiftLocalTimestamp(value: string, milliseconds: number) {
  return new Date(localMilliseconds(value) + milliseconds).toISOString().slice(0, 19);
}

export function buildSeriesReplacement(
  series: RecurrenceInput,
  currentStartsAt: Date,
  nextStartsAtLocal: string,
  cutoff: Date,
  horizon: Date,
  timezone = series.timezone,
): SeriesReplacement {
  const currentLocal = formatInTimeZone(currentStartsAt, timezone, localTimestampPattern);
  const normalizedNext = nextStartsAtLocal.replace(" ", "T").slice(0, 19);
  const selectedTarget = fromZonedTime(normalizedNext, timezone);
  const replacementHorizon = selectedTarget > horizon ? selectedTarget : horizon;
  const localDelta = localMilliseconds(normalizedNext) - localMilliseconds(currentLocal);
  const shiftedStart = shiftLocalTimestamp(series.startsAtLocal, localDelta);
  const originalStartDate = series.startsAtLocal.replace(" ", "T").slice(0, 10);
  const shiftedStartDate = shiftedStart.slice(0, 10);
  const dayDelta = Math.round(
    (Date.parse(`${shiftedStartDate}T12:00:00Z`) - Date.parse(`${originalStartDate}T12:00:00Z`)) /
      (24 * 60 * 60 * 1000),
  );
  const until = series.until ?? null;
  const exclusions = series.exclusions ?? [];
  const shiftedWeekdays = series.weekdays.map((weekday) => (weekday + dayDelta % 7 + 7) % 7);
  const shiftedWeekStartsOn = ((series.weekStartsOn ?? 1) + dayDelta % 7 + 7) % 7;
  const sourceHorizon = new Date(Math.max(
    replacementHorizon.getTime() - localDelta + 14 * 24 * 60 * 60 * 1000,
    currentStartsAt.getTime() + 14 * 24 * 60 * 60 * 1000,
  ));
  const source = expandSeries({ ...series, exclusions: [], horizon: sourceHorizon });
  const replacement = expandSeries({
    startsAtLocal: shiftedStart,
    timezone,
    frequency: series.frequency,
    weekdays: shiftedWeekdays,
    weekStartsOn: shiftedWeekStartsOn,
    until,
    exclusions,
    horizon: replacementHorizon,
  });

  const replacementKeys = new Set(replacement.map((date) => date.toISOString()));
  return {
    startsAtLocal: shiftedStart,
    timezone,
    frequency: series.frequency,
    weekdays: shiftedWeekdays,
    weekStartsOn: shiftedWeekStartsOn,
    until,
    exclusions,
    occurrences: source.flatMap((sourceDate) => {
      const sourceLocal = formatInTimeZone(sourceDate, timezone, localTimestampPattern);
      const startsAt = fromZonedTime(shiftLocalTimestamp(sourceLocal, localDelta), timezone);
      return sourceDate >= cutoff && startsAt <= replacementHorizon && replacementKeys.has(startsAt.toISOString())
        ? [{ sourceKey: sourceDate.toISOString(), startsAt: startsAt.toISOString() }]
        : [];
    }),
  };
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
    wkst: weekdayMap[input.weekStartsOn ?? 1],
  });

  return rule
    .all()
    .flatMap((date) => {
      const expectedLocal = date.toISOString().slice(0, 19);
      const occurrence = fromZonedTime(expectedLocal, input.timezone);
      return formatInTimeZone(occurrence, input.timezone, localTimestampPattern) === expectedLocal
        ? [occurrence]
        : [];
    })
    .filter((date) => !excluded.has(formatInTimeZone(date, input.timezone, "yyyy-MM-dd")));
}
