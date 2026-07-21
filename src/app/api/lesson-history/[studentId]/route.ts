import { AuthorizationError, requireApprovedUser } from "@/lib/auth";
import { getLessons } from "@/lib/data";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export async function GET(request: Request, { params }: { params: Promise<{ studentId: string }> }) {
  if (isSupabaseConfigured()) {
    try {
      await requireApprovedUser();
    } catch (error) {
      const status = error instanceof AuthorizationError ? error.status : 500;
      return Response.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
    }
  }
  const { studentId } = await params;
  const cursor = new URL(request.url).searchParams.get("cursor") ?? new Date().toISOString();
  const lessons = (await getLessons({ studentId, to: cursor, limit: 21 })).filter((lesson) => lesson.notes).reverse();
  const page = lessons.slice(0, 20);
  return Response.json({ lessons: page, nextCursor: lessons.length > 20 ? page.at(-1)?.startsAt : null }, { headers: { "cache-control": "private, no-store" } });
}
