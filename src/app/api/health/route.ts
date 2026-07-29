import { isDemoMode } from "@/lib/supabase/server";

function releaseSha() {
  const value = process.env.TEACHNOTES_RELEASE_SHA;
  return value && /^[0-9a-f]{40}$/.test(value) ? value : null;
}

export function GET() {
  return Response.json(
    {
      ok: true,
      service: "teachnotes",
      mode: isDemoMode() ? "demo" : "production",
      releaseSha: releaseSha(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
