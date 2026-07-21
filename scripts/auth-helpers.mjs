import fs from "node:fs";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

export function loadEnv(path) {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

export async function readSecret(prompt) {
  if (!process.stdin.isTTY) throw new Error("Run this command in an interactive terminal");
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      process.stdin.removeListener("data", onData);
    };
    const onData = (character) => {
      if (character === "\u0003") {
        finish();
        reject(new Error("Cancelled"));
      } else if (character === "\r" || character === "\n") {
        finish();
        resolve(value);
      } else if (character === "\u007f") {
        value = value.slice(0, -1);
      } else {
        value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

export function createAdminClient() {
  loadEnv(process.env.TEACHNOTES_ENV_FILE ?? ".env.local");
  const url = process.env.SUPABASE_INTERNAL_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Set the Supabase URL and server secret key first");
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function findUserByEmail(supabase, email) {
  const normalizedEmail = email.trim().toLocaleLowerCase("en-ZA");
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const user = data.users.find(
      (candidate) => candidate.email?.trim().toLocaleLowerCase("en-ZA") === normalizedEmail,
    );
    if (user) return user;
    if (data.users.length < perPage) return null;
  }
}

export async function protectOwnerAccount(supabase, user) {
  const { error: accountError } = await supabase.from("accounts").upsert(
    {
      user_id: user.id,
      email: user.email ?? "",
      role: "admin",
      status: "approved",
      must_change_password: false,
      is_protected: true,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (accountError) throw accountError;

  const { error: settingsError } = await supabase.from("business_settings").upsert(
    { owner_id: user.id, tutor_email: user.email ?? "" },
    { onConflict: "owner_id", ignoreDuplicates: true },
  );
  if (settingsError) throw settingsError;
}
