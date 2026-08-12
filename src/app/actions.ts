"use server";

import { addDays } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireApprovedUser } from "@/lib/auth";
import { expandSeries } from "@/lib/recurrence";
import { getBusinessSettings, getInvoice, getInvoicePreview, getStudent } from "@/lib/data";
import { generateInvoiceArtifacts, INVOICE_ARTIFACT_MIME } from "@/lib/invoice-artifacts";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Invoice } from "@/lib/types";

async function requireUser() {
  return (await requireApprovedUser()).user;
}

export async function signOut() {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}

const studentSchema = z.object({
  displayName: z.string().trim().min(2),
  guardianName: z.string().trim().optional(),
  billingEmail: z.string().trim().email().or(z.literal("")),
  billingAddress: z.string().trim().optional(),
  defaultDurationMinutes: z.coerce.number().int().min(15).max(240),
  defaultRateRand: z.coerce.number().min(0),
});

export type StudentArchiveState = { message: string };
export type StudentDefaultsState = {
  status: "idle" | "success" | "error";
  message: string;
};

function revalidateStudentArchivePaths(studentId: string) {
  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
  revalidatePath("/today");
  revalidatePath("/calendar");
  revalidatePath("/invoices/new");
}

export async function createStudent(formData: FormData) {
  if (!isSupabaseConfigured()) { revalidatePath("/students"); return; }
  const user = await requireUser();
  const values = studentSchema.parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.from("students").insert({
    owner_id: user.id,
    display_name: values.displayName,
    guardian_name: values.guardianName || null,
    billing_email: values.billingEmail || null,
    billing_address: values.billingAddress || null,
    default_duration_minutes: values.defaultDurationMinutes,
    default_rate_cents: Math.round(values.defaultRateRand * 100),
  });
  if (error) throw error;
  revalidatePath("/students");
}

export async function archiveStudent(_previousState: StudentArchiveState, formData: FormData): Promise<StudentArchiveState> {
  if (!isSupabaseConfigured()) return { message: "Student archiving is unavailable in the portfolio demo." };
  const parsed = z.string().uuid().safeParse(formData.get("studentId"));
  if (!parsed.success) return { message: "We couldn’t archive this student. Refresh the page and try again." };
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("archive_student", { p_student_id: parsed.data });
  if (error) return { message: "We couldn’t archive this student. Nothing was changed." };
  revalidateStudentArchivePaths(parsed.data);
  redirect("/students?view=archived");
}

export async function restoreStudent(_previousState: StudentArchiveState, formData: FormData): Promise<StudentArchiveState> {
  if (!isSupabaseConfigured()) return { message: "Student restoration is unavailable in the portfolio demo." };
  const parsed = z.string().uuid().safeParse(formData.get("studentId"));
  if (!parsed.success) return { message: "We couldn’t restore this student. Refresh the page and try again." };
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("restore_student", { p_student_id: parsed.data });
  if (error) return { message: "We couldn’t restore this student. Nothing was changed." };
  revalidateStudentArchivePaths(parsed.data);
  redirect(`/students/${parsed.data}`);
}

export async function createLessonSeries(formData: FormData) {
  if (!isSupabaseConfigured()) { revalidatePath("/calendar"); return; }
  const user = await requireUser();
  const studentId = z.string().uuid().parse(formData.get("studentId"));
  const startsAtLocal = z.string().min(10).parse(formData.get("startsAtLocal"));
  const frequency = z.enum(["weekly", "fortnightly"]).parse(formData.get("frequency"));
  const weekdays = formData.getAll("weekdays").map(Number);
  const until = String(formData.get("until") ?? "") || null;
  const exclusions = String(formData.get("exclusions") ?? "").split(",").map((value) => value.trim()).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  const student = await getStudent(studentId);
  if (!student || weekdays.length === 0) throw new Error("Choose a student and at least one weekday");
  const supabase = await createClient();
  const { data: series, error } = await supabase.from("lesson_series").insert({ owner_id: user.id, student_id: studentId, starts_at_local: startsAtLocal, timezone: "Africa/Johannesburg", frequency, weekdays, until, exclusions }).select("id").single();
  if (error) throw error;
  const occurrences = expandSeries({ startsAtLocal, timezone: "Africa/Johannesburg", frequency, weekdays, until, exclusions });
  const rows = occurrences.map((date) => ({ owner_id: user.id, student_id: studentId, series_id: series.id, occurrence_key: date.toISOString(), starts_at: date.toISOString(), duration_minutes: student.defaultDurationMinutes, rate_cents: student.defaultRateCents }));
  for (let offset = 0; offset < rows.length; offset += 500) {
    const { error: insertError } = await supabase.from("lessons").upsert(rows.slice(offset, offset + 500), { onConflict: "series_id,occurrence_key", ignoreDuplicates: true });
    if (insertError) throw insertError;
  }
  revalidatePath("/calendar");
  revalidatePath("/today");
}

export async function rescheduleLesson(formData: FormData) {
  if (!isSupabaseConfigured()) { revalidatePath("/calendar"); return; }
  await requireUser();
  const lessonId = z.string().uuid().parse(formData.get("lessonId"));
  const nextLocal = z.string().min(10).parse(formData.get("startsAtLocal"));
  const scope = z.enum(["one", "following", "all_future"]).parse(formData.get("scope"));
  const supabase = await createClient();
  const { data: current, error } = await supabase
    .from("lessons")
    .select("id, series_id, starts_at")
    .eq("id", lessonId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!current) {
    revalidatePath(`/lessons/${lessonId}`);
    revalidatePath("/calendar");
    revalidatePath("/today");
    return;
  }
  const next = fromZonedTime(nextLocal, "Africa/Johannesburg");
  if (scope === "one" || !current.series_id) {
    const { error: updateError } = await supabase
      .from("lessons")
      .update({ starts_at: next.toISOString(), status: "scheduled" })
      .eq("id", lessonId)
      .is("invoiced_at", null)
      .is("deleted_at", null);
    if (updateError) throw updateError;
  } else {
    const threshold = scope === "following" ? current.starts_at : new Date().toISOString();
    const delta = next.getTime() - new Date(current.starts_at).getTime();
    const { data: future, error: futureError } = await supabase
      .from("lessons")
      .select("id, starts_at")
      .eq("series_id", current.series_id)
      .eq("status", "scheduled")
      .is("invoiced_at", null)
      .is("deleted_at", null)
      .gte("starts_at", threshold)
      .order("starts_at");
    if (futureError) throw futureError;
    const results = await Promise.all(
      (future ?? []).map((item) =>
        supabase
          .from("lessons")
          .update({ starts_at: new Date(new Date(item.starts_at).getTime() + delta).toISOString() })
          .eq("id", item.id)
          .is("deleted_at", null),
      ),
    );
    const updateError = results.find((result) => result.error)?.error;
    if (updateError) throw updateError;
  }
  revalidatePath(`/lessons/${lessonId}`);
  revalidatePath("/calendar");
  revalidatePath("/today");
}

export async function updateStudentDefaults(_previousState: StudentDefaultsState, formData: FormData): Promise<StudentDefaultsState> {
  if (!isSupabaseConfigured()) return { status: "error", message: "Student defaults cannot be changed in the portfolio demo." };
  const parsed = z.object({
    studentId: z.string().uuid(),
    duration: z.coerce.number().int().min(15).max(240),
    rateRand: z.coerce.number().min(0),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: "Enter a duration from 15 to 240 minutes and a valid lesson amount." };
  const user = await requireUser();
  const { studentId, duration, rateRand } = parsed.data;
  const rateCents = Math.round(rateRand * 100);
  const applyFuture = formData.get("applyFuture") === "on";
  const supabase = await createClient();
  const { data: updatedStudent, error } = await supabase
    .from("students")
    .update({ default_duration_minutes: duration, default_rate_cents: rateCents })
    .eq("id", studentId)
    .eq("owner_id", user.id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error || !updatedStudent) return { status: "error", message: "We couldn’t save these lesson defaults. Nothing was changed." };
  if (applyFuture) {
    const { error: futureError } = await supabase
      .from("lessons")
      .update({ duration_minutes: duration, rate_cents: rateCents })
      .eq("owner_id", user.id)
      .eq("student_id", studentId)
      .eq("status", "scheduled")
      .is("invoiced_at", null)
      .is("deleted_at", null)
      .gt("starts_at", new Date().toISOString());
    if (futureError) return { status: "error", message: "The student defaults were saved, but future lessons could not be updated." };
  }
  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
  revalidatePath("/calendar");
  revalidatePath("/today");
  revalidatePath("/invoices/new");
  revalidatePath("/lessons/[id]", "page");
  return { status: "success", message: applyFuture ? "Defaults and future scheduled lessons saved." : "Lesson defaults saved." };
}

export async function saveSettings(formData: FormData) {
  if (!isSupabaseConfigured()) { revalidatePath("/settings"); return; }
  const user = await requireUser();
  const supabase = await createClient();
  const values = Object.fromEntries(formData);
  const { error } = await supabase.from("business_settings").upsert({ owner_id: user.id, tutor_name: values.tutorName, tutor_email: values.tutorEmail, tutor_phone: values.tutorPhone, tutor_address: values.tutorAddress, default_payer_name: values.defaultPayerName, default_payer_email: values.defaultPayerEmail, default_payer_address: values.defaultPayerAddress, payment_terms_days: Number(values.paymentTermsDays), bank_details: values.bankDetails, invoice_prefix: values.invoicePrefix, timezone: values.timezone }, { onConflict: "owner_id" });
  if (error) throw error;
  revalidatePath("/settings");
}

async function storeInvoiceArtifacts(userId: string, invoice: Invoice) {
  if (invoice.documentFormat !== "spreadsheet_v1" || invoice.status !== "finalized") {
    throw new Error("Only finalized spreadsheet invoices can generate artifacts");
  }
  const artifacts = await generateInvoiceArtifacts(invoice);
  const folder = `${userId}/${invoice.id}`;
  const xlsxPath = `${folder}/${artifacts.baseName}.xlsx`;
  const pdfPath = `${folder}/${artifacts.baseName}.pdf`;
  const supabase = await createClient();
  await storeImmutableInvoiceArtifact(supabase, xlsxPath, artifacts.xlsx, INVOICE_ARTIFACT_MIME.xlsx);
  await storeImmutableInvoiceArtifact(supabase, pdfPath, artifacts.pdf, INVOICE_ARTIFACT_MIME.pdf);
  const { error: updateError } = await supabase
    .from("invoices")
    .update({ xlsx_path: xlsxPath, pdf_path: pdfPath })
    .eq("id", invoice.id)
    .eq("owner_id", userId)
    .eq("document_format", "spreadsheet_v1")
    .select("id")
    .single();
  if (updateError) throw updateError;
}

async function storeImmutableInvoiceArtifact(
  supabase: SupabaseClient,
  path: string,
  contents: Buffer,
  contentType: string,
) {
  const bucket = supabase.storage.from("invoices");
  const { error: uploadError } = await bucket.upload(path, contents, { contentType, upsert: false });
  if (!uploadError) return;

  const { data: existing, error: downloadError } = await bucket.download(path);
  if (downloadError || !existing) throw uploadError;
  const existingContents = Buffer.from(await existing.arrayBuffer());
  if (!existingContents.equals(contents)) throw uploadError;
}

export async function finalizeInvoice(formData: FormData) {
  if (!isSupabaseConfigured()) { redirect("/invoices"); }
  const user = await requireUser();
  const month = z.string().regex(/^\d{4}-\d{2}$/).parse(formData.get("month"));
  const kind = z.enum(["consolidated", "student"]).parse(formData.get("kind"));
  const studentIdValue = String(formData.get("studentId") ?? "");
  const studentId = kind === "student" ? z.string().uuid().parse(studentIdValue) : undefined;
  const settings = await getBusinessSettings();
  const { lessons, totalCents, period } = await getInvoicePreview(month, studentId, settings);
  if (!lessons.length) throw new Error("There are no uninvoiced billable lessons in this selection");
  const student = studentId ? await getStudent(studentId, { includeArchived: true }) : null;
  const recipient = kind === "consolidated" ? { name: settings.defaultPayerName, email: settings.defaultPayerEmail, address: settings.defaultPayerAddress } : { name: student?.guardianName || student?.displayName || "Client", email: student?.billingEmail || "", address: student?.billingAddress || "" };
  const supabase = await createClient();
  const { data: number, error: numberError } = await supabase.rpc("next_invoice_number", { p_prefix: settings.invoicePrefix });
  if (numberError) throw numberError;
  const dueAt = addDays(new Date(), settings.paymentTermsDays);
  const { data: invoiceRow, error } = await supabase.from("invoices").insert({ owner_id: user.id, number, kind, status: "finalized", document_format: "spreadsheet_v1", student_id: studentId ?? null, period_start: period.start.toISOString(), period_end: period.end.toISOString(), tutor_snapshot: settings, recipient_snapshot: recipient, total_cents: totalCents, issued_at: new Date().toISOString(), due_at: dueAt.toISOString() }).select("id").single();
  if (error) throw error;
  const lines = lessons.map((lesson) => ({ invoice_id: invoiceRow.id, lesson_id: lesson.id, student_name: lesson.studentName, lesson_date: lesson.startsAt, duration_minutes: lesson.durationMinutes, lesson_status: lesson.status, amount_cents: lesson.rateCents }));
  const { error: lineError } = await supabase.from("invoice_lines").insert(lines);
  if (lineError) { await supabase.from("invoices").delete().eq("id", invoiceRow.id); throw lineError; }
  const { error: lessonUpdateError } = await supabase.from("lessons").update({ invoiced_at: new Date().toISOString() }).in("id", lessons.map((lesson) => lesson.id));
  if (lessonUpdateError) { await supabase.from("invoices").delete().eq("id", invoiceRow.id); throw lessonUpdateError; }
  const invoice = await getInvoice(invoiceRow.id) as Invoice;
  let artifactFailed = false;
  try {
    if (!invoice) throw new Error("Finalized invoice could not be reloaded");
    await storeInvoiceArtifacts(user.id, invoice);
  } catch (artifactError) {
    artifactFailed = true;
    console.error("Invoice artifact generation failed", { invoiceId: invoiceRow.id, artifactError });
  }
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceRow.id}`);
  redirect(`/invoices/${invoiceRow.id}${artifactFailed ? "?artifact=failed" : ""}`);
}

export async function saveDraftInvoice(formData: FormData) {
  if (!isSupabaseConfigured()) redirect("/invoices");
  const user = await requireUser();
  const month = z.string().regex(/^\d{4}-\d{2}$/).parse(formData.get("month"));
  const kind = z.enum(["consolidated", "student"]).parse(formData.get("kind"));
  const rawStudentId = String(formData.get("studentId") ?? "");
  const studentId = kind === "student" ? z.string().uuid().parse(rawStudentId) : undefined;
  const settings = await getBusinessSettings();
  const [{ totalCents, period }, student] = await Promise.all([
    getInvoicePreview(month, studentId, settings),
    studentId ? getStudent(studentId, { includeArchived: true }) : Promise.resolve(null),
  ]);
  const recipient = kind === "consolidated"
    ? { name: settings.defaultPayerName, email: settings.defaultPayerEmail, address: settings.defaultPayerAddress }
    : { name: student?.guardianName || student?.displayName || "Client", email: student?.billingEmail || "", address: student?.billingAddress || "" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("invoices").insert({ owner_id: user.id, kind, status: "draft", document_format: "spreadsheet_v1", student_id: studentId ?? null, period_start: period.start.toISOString(), period_end: period.end.toISOString(), tutor_snapshot: settings, recipient_snapshot: recipient, total_cents: totalCents }).select("id").single();
  if (error) throw error;
  redirect(`/invoices/${data.id}`);
}

export async function retryInvoiceArtifacts(formData: FormData) {
  if (!isSupabaseConfigured()) redirect("/invoices");
  const user = await requireUser();
  const invoiceId = z.string().uuid().parse(formData.get("invoiceId"));
  const invoice = await getInvoice(invoiceId);
  if (!invoice || invoice.status !== "finalized" || invoice.documentFormat !== "spreadsheet_v1") {
    throw new Error("Invoice artifacts cannot be generated for this invoice");
  }
  let failed = false;
  try {
    await storeInvoiceArtifacts(user.id, invoice);
  } catch (artifactError) {
    failed = true;
    console.error("Invoice artifact retry failed", { invoiceId, artifactError });
  }
  revalidatePath(`/invoices/${invoiceId}`);
  redirect(`/invoices/${invoiceId}?artifact=${failed ? "failed" : "ready"}`);
}

export async function voidInvoice(formData: FormData) {
  if (!isSupabaseConfigured()) return;
  await requireUser();
  const id = z.string().uuid().parse(formData.get("invoiceId"));
  const reason = z.string().trim().min(3).parse(formData.get("reason"));
  const supabase = await createClient();
  const { data: lines } = await supabase.from("invoice_lines").select("lesson_id").eq("invoice_id", id).is("released_at", null);
  const { error } = await supabase.from("invoices").update({ status: "void", void_reason: reason, voided_at: new Date().toISOString() }).eq("id", id).eq("status", "finalized");
  if (error) throw error;
  await supabase.from("invoice_lines").update({ released_at: new Date().toISOString() }).eq("invoice_id", id);
  if (lines?.length) await supabase.from("lessons").update({ invoiced_at: null }).in("id", lines.map((line) => line.lesson_id));
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
}
