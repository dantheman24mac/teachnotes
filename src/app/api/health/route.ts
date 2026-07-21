import { isDemoMode } from "@/lib/supabase/server";

export function GET() {
  return Response.json(
    {
      ok: true,
      service: "teachnotes",
      mode: isDemoMode() ? "demo" : "production",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
