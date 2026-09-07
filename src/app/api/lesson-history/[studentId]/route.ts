import { AuthorizationError, requireApprovedUser } from "@/lib/auth";
import { decodeLessonHistoryCursor, getLessonHistoryPage, getStudent } from "@/lib/data";
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
  const cursorValue = new URL(request.url).searchParams.get("cursor");
  const cursor = cursorValue ? decodeLessonHistoryCursor(cursorValue) : undefined;
  if (cursorValue && !cursor) return Response.json({ error: "Invalid cursor" }, { status: 400 });
  const student = await getStudent(studentId, { includeArchived: true });
  if (!student) return Response.json({ error: "Student not found" }, { status: 404 });
  const page = await getLessonHistoryPage({ studentId, cursor: cursor ?? undefined });
  return Response.json(page, { headers: { "cache-control": "private, no-store" } });
}
