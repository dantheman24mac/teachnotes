import { getLessons } from "@/lib/data";
import { getCurrentUser, isSupabaseConfigured } from "@/lib/supabase/server";

export async function GET(request: Request, { params }: { params: Promise<{ studentId: string }> }) {
  if (isSupabaseConfigured() && !(await getCurrentUser())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { studentId } = await params;
  const cursor = new URL(request.url).searchParams.get("cursor") ?? new Date().toISOString();
  const lessons = (await getLessons({ studentId, to: cursor, limit: 21 })).filter((lesson) => lesson.notes).reverse();
  const page = lessons.slice(0, 20);
  return Response.json({ lessons: page, nextCursor: lessons.length > 20 ? page.at(-1)?.startsAt : null }, { headers: { "cache-control": "private, no-store" } });
}
