import { addDays, addMonths, format, parseISO } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

type DateValue = Date | number | string;

export const DEFAULT_TIMEZONE = "Africa/Johannesburg";

export function formatInWorkspaceTime(value: DateValue, timezone: string, options: Intl.DateTimeFormatOptions) {
  const instant = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-ZA", { ...options, timeZone: timezone }).format(instant);
}

export function getWorkspaceDateKey(value: DateValue, timezone: string) {
  return formatInTimeZone(value, timezone, "yyyy-MM-dd");
}

export function formatDateTimeLocalValue(value: DateValue, timezone: string) {
  return formatInTimeZone(value, timezone, "yyyy-MM-dd'T'HH:mm");
}

function startOfWorkspaceDate(dateKey: string, timezone: string) {
  return fromZonedTime(`${dateKey}T00:00:00`, timezone);
}

export function getWorkspaceDayBounds(value: DateValue, timezone: string) {
  const dateKey = getWorkspaceDateKey(value, timezone);
  const nextDateKey = format(addDays(parseISO(dateKey), 1), "yyyy-MM-dd");
  return {
    start: startOfWorkspaceDate(dateKey, timezone),
    end: startOfWorkspaceDate(nextDateKey, timezone),
  };
}

export function getWorkspaceMonthBounds(month: string, timezone: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Use a month in YYYY-MM format");
  const startKey = `${month}-01`;
  const nextMonthKey = format(addMonths(parseISO(startKey), 1), "yyyy-MM-dd");
  return {
    start: startOfWorkspaceDate(startKey, timezone),
    end: startOfWorkspaceDate(nextMonthKey, timezone),
  };
}
