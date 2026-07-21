import { ArrowLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { requireAdminUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { UserApprovalPanel, type AdminAccount } from "./user-approval-panel";

export const metadata = { title: "User approvals" };
export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  await requireAdminUser();
  const admin = createAdminClient();
  const { data, error } = await admin.from("accounts").select("user_id,email,role,status,must_change_password,is_protected,created_at,reviewed_at").order("created_at", { ascending: false });
  if (error) throw new Error("Could not load user accounts");
  const accounts: AdminAccount[] = (data ?? []).map((row) => ({
    userId: row.user_id,
    email: row.email,
    role: row.role,
    status: row.status,
    mustChangePassword: row.must_change_password,
    protectedAdmin: row.is_protected,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  }));
  const pending = accounts.filter((account) => account.status === "pending").length;
  return <main className="admin-page"><header className="admin-header"><div><Link className="back-link" href="/today"><ArrowLeft size={16} /> Back to Today</Link><p className="eyebrow">Administration</p><h1>User approvals</h1><p className="subtle">Review account requests, revoke access, or issue a one-time password.</p></div><div className="admin-summary"><ShieldCheck /><strong>{pending}</strong><span>waiting</span></div></header><UserApprovalPanel accounts={accounts} /><div className="admin-signout"><SignOutButton /></div></main>;
}
