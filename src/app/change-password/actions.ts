"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getAccountContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ChangePasswordState = { message: string; resetTurnstile: number };

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  password: z.string().min(12).max(1024),
  confirmPassword: z.string().max(1024),
  captchaToken: z.string().max(4096).optional(),
}).refine((value) => value.password === value.confirmPassword, { path: ["confirmPassword"] });

export async function changeTemporaryPassword(previous: ChangePasswordState, formData: FormData): Promise<ChangePasswordState> {
  const context = await getAccountContext();
  if (!context) redirect("/login");
  if (!context.account || context.account.status !== "approved") redirect("/pending");
  if (!context.account.mustChangePassword) redirect("/today");

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    captchaToken: formData.get("captchaToken") || undefined,
  });
  if (!parsed.success) {
    return { message: "Enter your current password and a matching new password of at least 12 characters.", resetTurnstile: previous.resetTurnstile + 1 };
  }

  const email = context.user.email ?? context.account.email;
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.currentPassword,
    options: parsed.data.captchaToken ? { captchaToken: parsed.data.captchaToken } : undefined,
  });
  if (signInError) return { message: "The current password is incorrect.", resetTurnstile: previous.resetTurnstile + 1 };

  const { error: passwordError } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (passwordError) return { message: "We couldn't change the password. Try again.", resetTurnstile: previous.resetTurnstile + 1 };

  const admin = createAdminClient();
  const { error: accountError } = await admin.from("accounts").update({ must_change_password: false }).eq("user_id", context.user.id);
  if (accountError) {
    return { message: "Your password changed, but the account is still locked. Enter the new password above and try again.", resetTurnstile: previous.resetTurnstile + 1 };
  }
  redirect("/today");
}
