"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getAccountContext } from "@/lib/auth";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type LoginState = { message: string; resetTurnstile: number };

const credentialsSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(1024),
  captchaToken: z.string().max(4096).optional(),
});

function destinationFor(context: Awaited<ReturnType<typeof getAccountContext>>) {
  if (!context?.account || context.account.status !== "approved") return "/pending";
  if (context.account.mustChangePassword) return "/change-password";
  return "/today";
}

export async function signInWithPassword(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    captchaToken: formData.get("captchaToken") || undefined,
  });

  if (!isSupabaseConfigured()) {
    return { message: "Email and password sign-in is not configured.", resetTurnstile: _previousState.resetTurnstile + 1 };
  }

  if (!parsed.success) {
    return { message: "Enter a valid email address and password.", resetTurnstile: _previousState.resetTurnstile + 1 };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
    options: parsed.data.captchaToken ? { captchaToken: parsed.data.captchaToken } : undefined,
  });

  if (error) return { message: "Invalid email or password.", resetTurnstile: _previousState.resetTurnstile + 1 };
  redirect(destinationFor(await getAccountContext()));
}
