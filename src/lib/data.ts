import { endOfMonth, startOfMonth } from "date-fns";
import { demoInvoices, demoLessons, demoSettings, demoStudents } from "./demo-data";
import { calculateInvoiceTotal, isBillable } from "./domain";
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

function mapTutorSnapshot(value: unknown): BusinessSettings {
  const snapshot = (value && typeof value === "object" ? value : {}) as Partial<BusinessSettings>;
  return {
    tutorName: String(snapshot.tutorName ?? demoSettings.tutorName),
    tutorEmail: String(snapshot.tutorEmail ?? demoSettings.tutorEmail),
    tutorPhone: String(snapshot.tutorPhone ?? demoSettings.tutorPhone),
    tutorAddress: String(snapshot.tutorAddress ?? demoSettings.tutorAddress),
    defaultPayerName: String(snapshot.defaultPayerName ?? demoSettings.defaultPayerName),
    defaultPayerEmail: String(snapshot.defaultPayerEmail ?? demoSettings.defaultPayerEmail),
    defaultPayerAddress: String(snapshot.defaultPayerAddress ?? demoSettings.defaultPayerAddress),
    paymentTermsDays: Number(snapshot.paymentTermsDays ?? demoSettings.paymentTermsDays),
    bankDetails: String(snapshot.bankDetails ?? demoSettings.bankDetails),
    invoicePrefix: String(snapshot.invoicePrefix ?? demoSettings.invoicePrefix),
    timezone: String(snapshot.timezone ?? demoSettings.timezone),
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
  const { data } = await supabase.from("business_settings").select("*").eq("owner_id", user.id).maybeSingle();
  if (!data) return { ...demoSettings, tutorEmail: user.email ?? "" };
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

export async function getTodayDashboard() {
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const monthLessons = await getLessons({
    from: startOfMonth(now).toISOString(),
    to: endOfMonth(now).toISOString(),
  });
  return {
    todayLessons: monthLessons.filter(
      (lesson) => lesson.startsAt >= dayStart.toISOString() && lesson.startsAt < dayEnd.toISOString(),
    ),
    monthEarnings: calculateInvoiceTotal(monthLessons),
    completedCount: monthLessons.filter((lesson) => lesson.status !== "scheduled").length,
    billableCount: monthLessons.filter((lesson) =>
      isBillable(lesson.status, lesson.billingOverride),
    ).length,
  };
}

export async function ensureSeriesHorizon() {
  if (!isSupabaseConfigured()) return;
  const { user } = await requireApprovedUser();
  const supabase = await createClient();
  const { data: seriesRows } = await supabase.from("lesson_series").select("*, students(default_duration_minutes, default_rate_cents)").eq("active", true).is("deleted_at", null);
  for (const series of seriesRows ?? []) {
    const horizon = new Date(); horizon.setFullYear(horizon.getFullYear() + 1);
    const occurrences = expandSeries({ startsAtLocal: series.starts_at_local, timezone: series.timezone, frequency: series.frequency, weekdays: series.weekdays, until: series.until, exclusions: series.exclusions ?? [], horizon });
    const student = series.students as { default_duration_minutes: number; default_rate_cents: number };
    const rows = occurrences.map((date) => ({ owner_id: user.id, student_id: series.student_id, series_id: series.id, occurrence_key: date.toISOString(), starts_at: date.toISOString(), duration_minutes: student.default_duration_minutes, rate_cents: student.default_rate_cents }));
    for (let offset = 0; offset < rows.length; offset += 500) await supabase.from("lessons").upsert(rows.slice(offset, offset + 500), { onConflict: "series_id,occurrence_key", ignoreDuplicates: true });
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
  const eligible = lessons.filter(
    (lesson) => !lesson.invoiced && isBillable(lesson.status, lesson.billingOverride),
  );
  return { lessons: eligible, totalCents: calculateInvoiceTotal(eligible), period, settings };
}
