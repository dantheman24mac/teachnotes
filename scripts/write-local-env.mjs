import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const output = execFileSync("npx", ["supabase", "status", "-o", "json"], {
  cwd: process.cwd(),
  encoding: "utf8",
});
const status = JSON.parse(output.slice(output.indexOf("{")));
const contents = [
  `NEXT_PUBLIC_SUPABASE_URL=${status.API_URL}`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${status.PUBLISHABLE_KEY ?? status.ANON_KEY}`,
  `SUPABASE_SERVICE_ROLE_KEY=${status.SECRET_KEY ?? status.SERVICE_ROLE_KEY}`,
  "NEXT_PUBLIC_APP_URL=http://localhost:3000",
  "TURNSTILE_SITE_KEY=1x00000000000000000000AA",
  "TEACHNOTES_LOGIN_EMAIL=tutor@teachnotes.local",
  "DEMO_MODE=false",
  "",
].join("\n");

writeFileSync(".env.local", contents, { mode: 0o600 });
console.log("Wrote .env.local for the running Supabase project.");
