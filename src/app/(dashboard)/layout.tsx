import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { OfflineProvider } from "@/components/offline-provider";
import { accountDestination, getAccountContext } from "@/lib/auth";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const configured = isSupabaseConfigured();
  if (!configured) {
    return <OfflineProvider><AppShell demoMode>{children}</AppShell></OfflineProvider>;
  }

  const context = await getAccountContext();
  const destination = accountDestination(context);
  if (destination !== "/today") redirect(destination);

  const account = context!.account!;
  const isAdmin = account.role === "admin";
  let pendingUserCount = 0;
  if (isAdmin) {
    const supabase = await createClient();
    const { count } = await supabase
      .from("accounts")
      .select("user_id", { count: "exact", head: true })
      .eq("status", "pending");
    pendingUserCount = count ?? 0;
  }

  return (
    <OfflineProvider userId={context!.user.id} isBootstrapAdmin={account.protectedAdmin}>
      <AppShell demoMode={false} isAdmin={isAdmin} pendingUserCount={pendingUserCount}>
        {children}
      </AppShell>
    </OfflineProvider>
  );
}
