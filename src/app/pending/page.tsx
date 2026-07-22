import { redirect } from "next/navigation";
import { getAccountContext } from "@/lib/auth";
import { PendingStatus } from "./pending-status";

export const metadata = { title: "Account approval" };
export const dynamic = "force-dynamic";

export default async function PendingPage() {
  const context = await getAccountContext();
  if (!context) redirect("/login");
  if (context.account?.status === "approved") redirect(context.account.mustChangePassword ? "/change-password" : "/today");
  return <PendingStatus initialStatus={context.account?.status === "rejected" ? "rejected" : "pending"} email={context.account?.email ?? context.user.email ?? "Your account"} userId={context.user.id} />;
}
