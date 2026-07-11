import fs from "node:fs";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

function loadEnv(path) {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

async function readSecret(prompt) {
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

loadEnv(process.env.TEACHNOTES_ENV_FILE ?? ".env.local");

const url = process.env.SUPABASE_INTERNAL_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const email = process.env.TEACHNOTES_LOGIN_EMAIL;

if (!url || !serviceKey || !email) {
  throw new Error("Set the Supabase URL, server secret key, and TEACHNOTES_LOGIN_EMAIL first");
}

const password = await readSecret("New owner password: ");
const confirmation = await readSecret("Confirm password: ");
if (password !== confirmation) throw new Error("Passwords do not match");
if (password.length < 12) throw new Error("Use at least 12 characters");

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (error) throw error;

process.stdout.write(`Created the TeachNotes owner (${data.user.id}).\n`);
