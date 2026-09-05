import "server-only";

import { getBusinessSettings, getLessons } from "./data";
import { calculateBillableTotal, isBillable } from "./domain";
import { getWorkspaceDateKey, getWorkspaceDayBounds, getWorkspaceMonthBounds } from "./timezone";

export async function getTimezoneAwareTodayDashboard() {
  const now = new Date();
  const settings = await getBusinessSettings();
  const day = getWorkspaceDayBounds(now, settings.timezone);
  const month = getWorkspaceMonthBounds(getWorkspaceDateKey(now, settings.timezone).slice(0, 7), settings.timezone);
  const monthLessons = await getLessons({
    from: month.start.toISOString(),
    to: new Date(month.end.getTime() - 1).toISOString(),
  });

  return {
    todayLessons: monthLessons.filter((lesson) => {
      const startsAt = new Date(lesson.startsAt);
      return startsAt >= day.start && startsAt < day.end;
    }),
    monthEarnings: calculateBillableTotal(monthLessons),
    completedCount: monthLessons.filter((lesson) => lesson.status === "attended").length,
    billableCount: monthLessons.filter((lesson) => isBillable(lesson.status, lesson.billingOverride)).length,
    timezone: settings.timezone,
  };
}
