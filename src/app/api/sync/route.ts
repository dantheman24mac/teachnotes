import { z } from "zod";
import { demoLessons, demoStudents } from "@/lib/demo-data";
import { createClient, getCurrentUser, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Lesson, SyncOperation } from "@/lib/types";

const operationSchema = z.object({
  id: z.string().uuid(),
  lessonId: z.string().uuid(),
  baseVersion: z.number().int().min(1),
  patch: z.object({ notes: z.string().max(20000).optional(), status: z.enum(["scheduled", "attended", "canceled_rescheduled", "no_show"]).optional(), billingOverride: z.enum(["default", "billable", "non_billable"]).optional() }).refine((value) => Object.keys(value).length > 0),
  clientTimestamp: z.string().datetime(),
});

function mapLesson(row: Record<string, unknown>): Lesson {
  const student = row.students as { display_name?: string } | null;
  return { id: String(row.id), studentId: String(row.student_id), studentName: student?.display_name ?? "Student", startsAt: String(row.starts_at), durationMinutes: Number(row.duration_minutes), rateCents: Number(row.rate_cents), status: row.status as Lesson["status"], billingOverride: row.billing_override as Lesson["billingOverride"], notes: String(row.notes ?? ""), version: Number(row.version), syncRevision: Number(row.sync_revision), invoiced: Boolean(row.invoiced_at) };
}

export async function GET(request: Request) {
  const after = Math.max(0, Number(new URL(request.url).searchParams.get("after") ?? 0));
  if (!isSupabaseConfigured()) return Response.json({ revision: 100, lessons: demoLessons.filter((lesson) => lesson.syncRevision > after), students: demoStudents.filter((student) => (student.syncRevision ?? 0) > after), tombstones: [] }, { headers: { "cache-control": "private, no-store" } });
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = await createClient();
  const [{ data: lessonRows, error: lessonError }, { data: studentRows, error: studentError }] = await Promise.all([
    supabase.from("lessons").select("*, students(display_name)").gt("sync_revision", after).order("sync_revision").limit(500),
    supabase.from("students").select("*").gt("sync_revision", after).order("sync_revision").limit(500),
  ]);
  if (lessonError || studentError) return Response.json({ error: "Sync failed" }, { status: 500 });
  const revision = Math.max(after, ...(lessonRows ?? []).map((row) => Number(row.sync_revision)), ...(studentRows ?? []).map((row) => Number(row.sync_revision)));
  return Response.json({ revision, lessons: (lessonRows ?? []).filter((row) => !row.deleted_at).map(mapLesson), students: (studentRows ?? []).filter((row) => !row.deleted_at), tombstones: [...(lessonRows ?? []).filter((row) => row.deleted_at).map((row) => ({ entity: "lesson", id: row.id })), ...(studentRows ?? []).filter((row) => row.deleted_at).map((row) => ({ entity: "student", id: row.id }))] }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = z.object({ operations: z.array(operationSchema).max(100) }).safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid sync payload", details: parsed.error.flatten() }, { status: 400 });
  if (!isSupabaseConfigured()) {
    const applied = parsed.data.operations.map((operation) => {
      const existing = demoLessons.find((lesson) => lesson.id === operation.lessonId)!;
      return { operationId: operation.id, lesson: { ...existing, ...operation.patch, version: operation.baseVersion + 1, syncRevision: existing.syncRevision + 100 } };
    });
    return Response.json({ applied, conflicts: [] });
  }
  if (!(await getCurrentUser())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = await createClient();
  const applied: Array<{ operationId: string; lesson: Lesson }> = [];
  const conflicts: Array<{ operation: SyncOperation; serverLesson: Lesson }> = [];
  for (const operation of parsed.data.operations) {
    const { data, error } = await supabase.rpc("apply_lesson_operation", { p_operation_id: operation.id, p_lesson_id: operation.lessonId, p_base_version: operation.baseVersion, p_patch: { notes: operation.patch.notes, status: operation.patch.status, billing_override: operation.patch.billingOverride } });
    if (error) return Response.json({ error: "Sync operation failed" }, { status: 500 });
    const result = data as { status: "applied" | "conflict"; lesson: Record<string, unknown> };
    const lesson = mapLesson(result.lesson);
    if (result.status === "conflict") conflicts.push({ operation, serverLesson: lesson }); else applied.push({ operationId: operation.id, lesson });
  }
  return Response.json({ applied, conflicts }, { headers: { "cache-control": "private, no-store" } });
}
