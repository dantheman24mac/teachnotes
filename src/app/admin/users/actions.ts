"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ManageAccountState = { message: string; temporaryPassword?: string };

const actionSchema = z.object({
  userId: z.string().uuid(),
  operation: z.enum(["approve", "reject", "reset-password"]),
});

export async function manageAccount(_previous: ManageAccountState, formData: FormData): Promise<ManageAccountState> {
  await requireAdminUser();
  const parsed = actionSchema.safeParse({ userId: formData.get("userId"), operation: formData.get("operation") });
  if (!parsed.success) return { message: "Invalid account action." };

  const admin = createAdminClient();
  const { data: target, error: targetError } = await admin.from("accounts").select("user_id,email,status,is_protected").eq("user_id", parsed.data.userId).maybeSingle();
  if (targetError || !target) return { message: "That account no longer exists." };
  if (target.is_protected) return { message: "The bootstrap administrator cannot be changed here." };

  if (parsed.data.operation === "approve" || parsed.data.operation === "reject") {
    const supabase = await createClient();
    const { error } = await supabase.rpc("review_account", {
      p_user_id: parsed.data.userId,
      p_status: parsed.data.operation === "approve" ? "approved" : "rejected",
    });
    if (error) return { message: "The account status could not be changed." };
    revalidatePath("/admin/users");
    return { message: parsed.data.operation === "approve" ? "Account approved." : "Account rejected and access revoked." };
  }

  if (target.status !== "approved") return { message: "Approve this account before resetting its password." };
  const temporaryPassword = `${randomBytes(24).toString("base64url")}!Aa1`;
  const { error: lockError } = await admin.from("accounts").update({ must_change_password: true }).eq("user_id", parsed.data.userId).eq("is_protected", false);
  if (lockError) return { message: "The account could not be locked for a password reset." };

  const { error: passwordError } = await admin.auth.admin.updateUserById(parsed.data.userId, { password: temporaryPassword });
  if (passwordError) return { message: "The account is locked, but a temporary password could not be created. Retry the reset." };
  revalidatePath("/admin/users");
  return { message: "Temporary password created. Copy it now; it will not be shown again.", temporaryPassword };
}
