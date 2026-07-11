import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { OfflineProvider } from "@/components/offline-provider";
import { getCurrentUser, isSupabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const configured = isSupabaseConfigured();
  if (configured && !(await getCurrentUser())) redirect("/login");
  return <OfflineProvider><AppShell demoMode={!configured}>{children}</AppShell></OfflineProvider>;
}
