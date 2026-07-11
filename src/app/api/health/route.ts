export function GET() {
  return Response.json({ ok: true, service: "teachnotes" }, { headers: { "cache-control": "no-store" } });
}
