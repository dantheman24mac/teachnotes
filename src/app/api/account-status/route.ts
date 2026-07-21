import { getAccountContext } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getAccountContext();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "cache-control": "private, no-store" } });
  return Response.json({
    status: context.account?.status ?? "pending",
    mustChangePassword: context.account?.mustChangePassword ?? false,
  }, { headers: { "cache-control": "private, no-store" } });
}
