import { TodayAgenda } from "@/components/today-agenda";
import { getTodayDashboard } from "@/lib/data";

export const metadata = { title: "Today" };

export default async function TodayPage() {
  const dashboard = await getTodayDashboard();
  return <TodayAgenda initialLessons={dashboard.todayLessons} monthEarnings={dashboard.monthEarnings} completedCount={dashboard.completedCount} billableCount={dashboard.billableCount} />;
}
