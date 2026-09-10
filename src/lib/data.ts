import { demoInvoices, demoLessons, demoSettings, demoStudents } from "./demo-data";
import {
  calculateInvoiceTotal,
  getInvoiceEligibleLessons,
} from "./domain";
import { expandSeries } from "./recurrence";
import { requireApprovedUser } from "./auth";
import { createClient, isSupabaseConfigured } from "./supabase/server";
import { getWorkspaceInvoicePeriod } from "./timezone";
import type { BusinessSettings, Invoice, InvoiceRecipientSnapshot, Lesson, Student } from "./types";

function mapStudent(row: Record<string, unknown>): Student {
  return {
    id: String(row.id),
    ownerId: row.owner_id ? String(row.owner_id) : undefined,
    displayName: String(row.display_name),
    guardianName: row.guardian_name ? String(row.guardian_name) : null,
    billingEmail: row.billing_email ? String(row.billing_email) : null,
    billingAddress: row.billing_address ? String(row.billing_address) : null,
    defaultDurationMinutes: Number(row.default_duration_minutes),
    defaultRateCents: Number(row.default_rate_cents),
    active: Boolean(row.active),
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    syncRevision: Number(row.sync_revision ?? 0),
  };
}

function mapLesson(row: Record<string, unknown>): Lesson {
  const student = row.students as { display_name?: string } | null;
  return {
    id: String(row.id),
    studentId: String(row.student_id),
    studentName: student?.display_name ?? String(row.student_name ?? "Student"),
    startsAt: String(row.starts_at),
    durationMinutes: Number(row.duration_minutes),
    rateCents: Number(row.rate_cents),
    status: row.status as Lesson["status"],
    billingOverride: row.billing_override as Lesson["billingOverride"],
    notes: String(row.notes ?? ""),
    version: Number(row.version),
    syncRevision: Number(row.sync_revision),
    invoiced: Boolean(row.invoiced_at ?? row.invoiced),
  };
}

const blankBusinessSettings: BusinessSettings = {
  tutorName: "",
  tutorEmail: "",
  tutorPhone: "",
  tutorAddress: "",
  defaultPayerName: "",
  defaultPayerEmail: "",
  defaultPayerAddress: "",
  paymentTermsDays: 7,
  bankDetails: "",
  invoicePrefix: "INV",
  timezone: "Africa/Johannesburg",
  currency: "ZAR",
};

function mapTutorSnapshot(value: unknown): BusinessSettings {
  const snapshot = (value && typeof value === "object" ? value : {}) as Partial<BusinessSettings>;
  return {
    tutorName: String(snapshot.tutorName ?? blankBusinessSettings.tutorName),
    tutorEmail: String(snapshot.tutorEmail ?? blankBusinessSettings.tutorEmail),
    tutorPhone: String(snapshot.tutorPhone ?? blankBusinessSettings.tutorPhone),
    tutorAddress: String(snapshot.tutorAddress ?? blankBusinessSettings.tutorAddress),
    defaultPayerName: String(snapshot.defaultPayerName ?? blankBusinessSettings.defaultPayerName),
    defaultPayerEmail: String(snapshot.defaultPayerEmail ?? blankBusinessSettings.defaultPayerEmail),
    defaultPayerAddress: String(snapshot.defaultPayerAddress ?? blankBusinessSettings.defaultPayerAddress),
    paymentTermsDays: Number(snapshot.paymentTermsDays ?? blankBusinessSettings.paymentTermsDays),
    bankDetails: String(snapshot.bankDetails ?? blankBusinessSettings.bankDetails),
    invoicePrefix: String(snapshot.invoicePrefix ?? blankBusinessSettings.invoicePrefix),
    timezone: String(snapshot.timezone ?? blankBusinessSettings.timezone),
    currency: "ZAR",
  };
}

function mapRecipientSnapshot(value: unknown): InvoiceRecipientSnapshot {
  const snapshot = (value && typeof value === "object" ? value : {}) as Partial<InvoiceRecipientSnapshot>;
  return {
    name: String(snapshot.name ?? ""),
    email: String(snapshot.email ?? ""),
    address: String(snapshot.address ?? ""),
  };
}

type InvoiceDatabaseRow = Record<string, unknown> & { invoice_lines?: Array<Record<string, unknown>> };

function mapInvoice(row: InvoiceDatabaseRow): Invoice {
  const recipientSnapshot = mapRecipientSnapshot(row.recipient_snapshot);
  return {
    id: String(row.id),
    number: row.number ? String(row.number) : null,
    kind: row.kind as Invoice["kind"],
    studentId: row.student_id ? String(row.student_id) : null,
    status: row.status as Invoice["status"],
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end),
    recipientName: recipientSnapshot.name,
    recipientSnapshot,
    tutorSnapshot: mapTutorSnapshot(row.tutor_snapshot),
    totalCents: Number(row.total_cents),
    issuedAt: row.issued_at ? String(row.issued_at) : null,
    dueAt: row.due_at ? String(row.due_at) : null,
    voidReason: row.void_reason ? String(row.void_reason) : null,
    documentFormat: row.document_format === "spreadsheet_v1" ? "spreadsheet_v1" : "legacy_pdf",
    pdfPath: row.pdf_path ? String(row.pdf_path) : null,
    xlsxPath: row.xlsx_path ? String(row.xlsx_path) : null,
    lines: (row.invoice_lines ?? [])
      .map((line: Record<string, unknown>) => ({
        id: String(line.id),
        lessonId: String(line.lesson_id),
        studentName: String(line.student_name),
        lessonDate: String(line.lesson_date),
        durationMinutes: Number(line.duration_minutes),
        status: line.lesson_status as Lesson["status"],
        amountCents: Number(line.amount_cents),
      }))
      .sort((left: { lessonDate: string }, right: { lessonDate: string }) => left.lessonDate.localeCompare(right.lessonDate)),
  };
}

export type StudentStatus = "active" | "archived" | "all";

export async function getStudents(options?: { status?: StudentStatus }): Promise<Student[]> {
  const status = options?.status ?? "active";
  if (!isSupabaseConfigured()) {
    return demoStudents.filter((student) => {
      if (status === "all") return true;
      return status === "archived" ? Boolean(student.deletedAt) : student.active && !student.deletedAt;
    });
  }
  await requireApprovedUser();
  const supabase = await createClient();
  let query = supabase
    .from("students")
    .select("*")
    .order("display_name");
  if (status === "active") query = query.eq("active", true).is("deleted_at", null);
  if (status === "archived") query = query.not("deleted_at", "is", null);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(mapStudent);
}

export async function getStudent(id: string, options?: { includeArchived?: boolean }) {
  if (!isSupabaseConfigured()) {
    const student = demoStudents.find((item) => item.id === id) ?? null;
    if (!options?.includeArchived && student?.deletedAt) return null;
    return student;
  }
  await requireApprovedUser();
  const supabase = await createClient();
  let query = supabase.from("students").select("*").eq("id", id);
  if (!options?.includeArchived) query = query.eq("active", true).is("deleted_at", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? mapStudent(data) : null;
}

export async function getLessons(options?: {
  from?: string;
  to?: string;
  studentId?: string;
  limit?: number;
}): Promise<Lesson[]> {
  if (!isSupabaseConfigured()) {
    return demoLessons
      .filter((lesson) => !options?.studentId || lesson.studentId === options.studentId)
      .filter((lesson) => !options?.from || lesson.startsAt >= options.from)
      .filter((lesson) => !options?.to || lesson.startsAt <= options.to)
      .slice(0, options?.limit ?? 500);
  }
  await requireApprovedUser();
  const supabase = await createClient();
  let query = supabase
    .from("lessons")
    .select("*, students(display_name)")
    .is("deleted_at", null)
    .order("starts_at", { ascending: true })
    .limit(options?.limit ?? 500);
  if (options?.from) query = query.gte("starts_at", options.from);
  if (options?.to) query = query.lte("starts_at", options.to);
  if (options?.studentId) query = query.eq("student_id", options.studentId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(mapLesson);
}

export interface LessonHistoryCursor {
  startsAt: string;
  id: string;
}

export interface LessonHistoryPage {
  lessons: Lesson[];
  nextCursor: string | null;
}

const lessonIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const lessonCursorTimestampPattern = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const lessonHistoryCursorMaxLength = 256;

export function encodeLessonHistoryCursor(cursor: LessonHistoryCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeLessonHistoryCursor(value: string): LessonHistoryCursor | null {
  if (value.length > lessonHistoryCursorMaxLength) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<LessonHistoryCursor>;
    if (typeof parsed.startsAt !== "string"
      || !lessonCursorTimestampPattern.test(parsed.startsAt)
      || Number.isNaN(Date.parse(parsed.startsAt))
      || typeof parsed.id !== "string"
      || !lessonIdPattern.test(parsed.id)) return null;
    return { startsAt: parsed.startsAt, id: parsed.id };
  } catch {
    return null;
  }
}

export async function getUpcomingLessons(studentId: string, from: string, limit = 5): Promise<Lesson[]> {
  if (!isSupabaseConfigured()) {
    return demoLessons
      .filter((lesson) => lesson.studentId === studentId && lesson.startsAt >= from)
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.id.localeCompare(right.id))
      .slice(0, limit);
  }
  await requireApprovedUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lessons")
    .select("*, students(display_name)")
    .eq("student_id", studentId)
    .is("deleted_at", null)
    .gte("starts_at", from)
    .order("starts_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(mapLesson);
}

async function getPastLessonNotes(options: {
  studentId: string;
  before: LessonHistoryCursor | { startsAt: string };
  limit: number;
}): Promise<Lesson[]> {
  if (!isSupabaseConfigured()) {
    return demoLessons
      .filter((lesson) => lesson.studentId === options.studentId && Boolean(lesson.notes))
      .filter((lesson) => lesson.startsAt < options.before.startsAt
        || ("id" in options.before && lesson.startsAt === options.before.startsAt && lesson.id < options.before.id))
      .sort((left, right) => right.startsAt.localeCompare(left.startsAt) || right.id.localeCompare(left.id))
      .slice(0, options.limit);
  }
  await requireApprovedUser();
  const supabase = await createClient();
  let query = supabase
    .from("lessons")
    .select("*, students(display_name)")
    .eq("student_id", options.studentId)
    .is("deleted_at", null)
    .neq("notes", "")
    .order("starts_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(options.limit);
  if ("id" in options.before) {
    query = query.or(`starts_at.lt.${options.before.startsAt},and(starts_at.eq.${options.before.startsAt},id.lt.${options.before.id})`);
  } else {
    query = query.lt("starts_at", options.before.startsAt);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(mapLesson);
}

export async function getLessonHistoryPage(options: {
  studentId: string;
  before?: string;
  cursor?: LessonHistoryCursor;
  pageSize?: number;
}): Promise<LessonHistoryPage> {
  const pageSize = options.pageSize ?? 20;
  const before = options.cursor ?? { startsAt: options.before ?? new Date().toISOString() };
  const lessons = await getPastLessonNotes({ studentId: options.studentId, before, limit: pageSize + 1 });
  const page = lessons.slice(0, pageSize);
  const lastLesson = page.at(-1);
  return {
    lessons: page,
    nextCursor: lessons.length > pageSize && lastLesson
      ? encodeLessonHistoryCursor({ startsAt: lastLesson.startsAt, id: lastLesson.id })
      : null,
  };
}

export async function getPreviousLessonNotes(studentId: string, before: string, limit = 20) {
  return getPastLessonNotes({ studentId, before: { startsAt: before }, limit });
}

export async function getLesson(id: string) {
  if (!isSupabaseConfigured()) return demoLessons.find((item) => item.id === id) ?? null;
  await requireApprovedUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lessons")
    .select("*, students(display_name)")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data ? mapLesson(data) : null;
}

export async function getBusinessSettings(): Promise<BusinessSettings> {
  if (!isSupabaseConfigured()) return demoSettings;
  const { user } = await requireApprovedUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("business_settings").select("*").eq("owner_id", user.id).maybeSingle();
  if (error) throw error;
  if (!data) return { ...blankBusinessSettings };
  return {
    tutorName: data.tutor_name ?? "",
    tutorEmail: data.tutor_email ?? user.email ?? "",
    tutorPhone: data.tutor_phone ?? "",
    tutorAddress: data.tutor_address ?? "",
    defaultPayerName: data.default_payer_name ?? "",
    defaultPayerEmail: data.default_payer_email ?? "",
    defaultPayerAddress: data.default_payer_address ?? "",
    paymentTermsDays: data.payment_terms_days ?? 7,
    bankDetails: data.bank_details ?? "",
    invoicePrefix: data.invoice_prefix ?? "INV",
    timezone: data.timezone ?? "Africa/Johannesburg",
    currency: "ZAR",
  };
}

export async function ensureSeriesHorizon() {
  if (!isSupabaseConfigured()) return;
  await requireApprovedUser();
  const supabase = await createClient();
  const { data: seriesRows, error: seriesError } = await supabase
    .from("lesson_series")
    .select("*")
    .eq("active", true)
    .is("deleted_at", null);
  if (seriesError) throw seriesError;
  for (const series of seriesRows ?? []) {
    const horizon = new Date(); horizon.setFullYear(horizon.getFullYear() + 1);
    const materializeFrom = series.materialize_from ? new Date(series.materialize_from) : null;
    const occurrences = expandSeries({ startsAtLocal: series.starts_at_local, timezone: series.timezone, frequency: series.frequency, weekdays: series.weekdays, weekStartsOn: series.week_starts_on, until: series.until, exclusions: series.exclusions ?? [], horizon })
      .filter((date) => !materializeFrom || date >= materializeFrom)
      .map((date) => date.toISOString());
    const { error } = await supabase.rpc("materialize_lesson_series", {
      p_series_id: series.id,
      p_schedule_revision: series.schedule_revision,
      p_occurrences: occurrences,
    });
    if (error) throw error;
  }
}

export async function getInvoices(): Promise<Invoice[]> {
  if (!isSupabaseConfigured()) return demoInvoices;
  await requireApprovedUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("*, invoice_lines(*)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapInvoice);
}

export async function getInvoice(id: string) {
  if (!isSupabaseConfigured()) return demoInvoices.find((invoice) => invoice.id === id) ?? null;
  await requireApprovedUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("*, invoice_lines(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapInvoice(data) : null;
}

export async function getInvoicePreview(
  month: string,
  studentId?: string,
  settingsOverride?: BusinessSettings,
) {
  const settings = settingsOverride ?? await getBusinessSettings();
  const period = getWorkspaceInvoicePeriod(month, settings.timezone);
  const lessons = await getLessons({ from: period.start.toISOString(), to: period.end.toISOString(), studentId });
  const eligible = getInvoiceEligibleLessons(lessons);
  return { lessons: eligible, totalCents: calculateInvoiceTotal(eligible), period, settings };
}
