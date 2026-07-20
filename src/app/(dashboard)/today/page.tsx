import { TimezoneAwareTodayAgenda } from "@/components/timezone-aware-today-agenda";
import { getTimezoneAwareTodayDashboard } from "@/lib/timezone-data";

export const metadata = { title: "Today" };

export default async function TodayPage() {
  const dashboard = await getTimezoneAwareTodayDashboard();
  return <TimezoneAwareTodayAgenda initialLessons={dashboard.todayLessons} monthEarnings={dashboard.monthEarnings} completedCount={dashboard.completedCount} billableCount={dashboard.billableCount} timezone={dashboard.timezone} />;
}
