"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type LoginState = { message: string };

const credentialsSchema = z.object({
  username: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(1024),
});

function matchesUsername(candidate: string, configured: string) {
  const digest = (value: string) =>
    createHash("sha256").update(value.trim().toLocaleLowerCase("en-ZA")).digest();
  return timingSafeEqual(digest(candidate), digest(configured));
}

export async function signInWithPassword(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = credentialsSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });
  const configuredUsername = process.env.TEACHNOTES_LOGIN_USERNAME;
  const configuredEmail = process.env.TEACHNOTES_LOGIN_EMAIL;

  if (!isSupabaseConfigured() || !configuredUsername || !configuredEmail) {
    return { message: "Username and password sign-in is not configured." };
  }

  if (!parsed.success || !matchesUsername(parsed.data.username, configuredUsername)) {
    return { message: "Invalid username or password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: configuredEmail,
    password: parsed.data.password,
  });

  if (error) return { message: "Invalid username or password." };
  redirect("/today");
}
