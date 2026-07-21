import "server-only";

import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type AccountRole = "admin" | "user";
export type AccountStatus = "pending" | "approved" | "rejected";

export interface Account {
  userId: string;
  email: string;
  role: AccountRole;
  status: AccountStatus;
  mustChangePassword: boolean;
  protectedAdmin: boolean;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

export interface AccountContext {
  user: User;
  account: Account | null;
}

export type AuthorizedAccountContext = AccountContext & { account: Account };

export class AuthorizationError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

function mapAccount(row: Record<string, unknown>): Account {
  return {
    userId: String(row.user_id),
    email: String(row.email ?? ""),
    role: row.role as AccountRole,
    status: row.status as AccountStatus,
    mustChangePassword: Boolean(row.must_change_password),
    protectedAdmin: Boolean(row.is_protected),
    createdAt: String(row.created_at),
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
  };
}

export const getAccountContext = cache(async (): Promise<AccountContext | null> => {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return null;

  const { data, error } = await supabase
    .from("accounts")
    .select("user_id,email,role,status,must_change_password,is_protected,created_at,reviewed_at,reviewed_by")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;
  return { user, account: data ? mapAccount(data) : null };
});

export function accountDestination(context: AccountContext | null) {
  if (!context) return "/login";
  if (!context.account || context.account.status !== "approved") return "/pending";
  if (context.account.mustChangePassword) return "/change-password";
  return "/today";
}

export async function requireApprovedUser(): Promise<AuthorizedAccountContext> {
  const context = await getAccountContext();
  if (!context) throw new AuthorizationError("You must be signed in", 401);
  if (
    !context.account ||
    context.account.status !== "approved" ||
    context.account.mustChangePassword
  ) {
    throw new AuthorizationError("Your account is not approved for application access", 403);
  }
  return context as AuthorizedAccountContext;
}

export async function requireAdminUser(): Promise<AuthorizedAccountContext> {
  const context = await requireApprovedUser();
  if (context.account.role !== "admin") {
    throw new AuthorizationError("Administrator access is required", 403);
  }
  return context;
}
