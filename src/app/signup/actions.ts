"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type SignupState = { message: string; resetTurnstile: number };

const signupSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(12).max(1024),
  confirmPassword: z.string().max(1024),
  captchaToken: z.string().max(4096).optional(),
}).refine((value) => value.password === value.confirmPassword, {
  path: ["confirmPassword"],
  message: "Passwords do not match",
});

export async function signUpWithPassword(previous: SignupState, formData: FormData): Promise<SignupState> {
  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    captchaToken: formData.get("captchaToken") || undefined,
  });

  if (!isSupabaseConfigured()) {
    return { message: "Account registration is not configured.", resetTurnstile: previous.resetTurnstile + 1 };
  }
  if (!parsed.success) {
    const mismatch = parsed.error.issues.some((issue) => issue.path.includes("confirmPassword"));
    return { message: mismatch ? "The passwords do not match." : "Use a valid email and a password of at least 12 characters.", resetTurnstile: previous.resetTurnstile + 1 };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: parsed.data.captchaToken ? { captchaToken: parsed.data.captchaToken } : undefined,
  });

  if (error || !data.session) {
    return { message: "We couldn't create that account. Check your details and try again.", resetTurnstile: previous.resetTurnstile + 1 };
  }
  redirect("/pending");
}
