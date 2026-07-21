"use server";

import { addDays, endOfMonth } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireApprovedUser } from "@/lib/auth";
import { expandSeries } from "@/lib/recurrence";
import { getBusinessSettings, getInvoice, getInvoicePreview, getStudent } from "@/lib/data";
import { renderInvoicePdf } from "@/lib/invoice-pdf";
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
  const { data: current, error } = await supabase.from("lessons").select("id, series_id, starts_at").eq("id", lessonId).single();
  if (error) throw error;
  const next = fromZonedTime(nextLocal, "Africa/Johannesburg");
  if (scope === "one" || !current.series_id) {
    await supabase.from("lessons").update({ starts_at: next.toISOString(), status: "scheduled" }).eq("id", lessonId).is("invoiced_at", null);
  } else {
    const threshold = scope === "following" ? current.starts_at : new Date().toISOString();
    const delta = next.getTime() - new Date(current.starts_at).getTime();
    const { data: future, error: futureError } = await supabase.from("lessons").select("id, starts_at").eq("series_id", current.series_id).eq("status", "scheduled").is("invoiced_at", null).gte("starts_at", threshold).order("starts_at");
    if (futureError) throw futureError;
    await Promise.all((future ?? []).map((item) => supabase.from("lessons").update({ starts_at: new Date(new Date(item.starts_at).getTime() + delta).toISOString() }).eq("id", item.id)));
  }
  revalidatePath(`/lessons/${lessonId}`);
  revalidatePath("/calendar");
  revalidatePath("/today");
}

export async function updateStudentDefaults(formData: FormData) {
  if (!isSupabaseConfigured()) return;
  await requireUser();
  const studentId = z.string().uuid().parse(formData.get("studentId"));
  const duration = z.coerce.number().int().min(15).max(240).parse(formData.get("duration"));
  const rateCents = Math.round(z.coerce.number().min(0).parse(formData.get("rateRand")) * 100);
  const applyFuture = formData.get("applyFuture") === "on";
  const supabase = await createClient();
  const { error } = await supabase.from("students").update({ default_duration_minutes: duration, default_rate_cents: rateCents }).eq("id", studentId);
  if (error) throw error;
  if (applyFuture) await supabase.from("lessons").update({ duration_minutes: duration, rate_cents: rateCents }).eq("student_id", studentId).eq("status", "scheduled").is("invoiced_at", null).gt("starts_at", new Date().toISOString());
  revalidatePath(`/students/${studentId}`);
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

export async function finalizeInvoice(formData: FormData) {
  if (!isSupabaseConfigured()) { redirect("/invoices"); }
  const user = await requireUser();
  const month = z.string().regex(/^\d{4}-\d{2}$/).parse(formData.get("month"));
  const kind = z.enum(["consolidated", "student"]).parse(formData.get("kind"));
  const studentIdValue = String(formData.get("studentId") ?? "");
  const studentId = kind === "student" ? z.string().uuid().parse(studentIdValue) : undefined;
  const { lessons, totalCents } = await getInvoicePreview(month, studentId);
  if (!lessons.length) throw new Error("There are no uninvoiced billable lessons in this selection");
  const settings = await getBusinessSettings();
  const student = studentId ? await getStudent(studentId) : null;
  const recipient = kind === "consolidated" ? { name: settings.defaultPayerName, email: settings.defaultPayerEmail, address: settings.defaultPayerAddress } : { name: student?.guardianName || student?.displayName || "Client", email: student?.billingEmail || "", address: student?.billingAddress || "" };
  const periodStart = new Date(`${month}-01T00:00:00+02:00`);
  const periodEnd = endOfMonth(periodStart);
  const supabase = await createClient();
  const { data: number, error: numberError } = await supabase.rpc("next_invoice_number", { p_prefix: settings.invoicePrefix });
  if (numberError) throw numberError;
  const dueAt = addDays(new Date(), settings.paymentTermsDays);
  const { data: invoiceRow, error } = await supabase.from("invoices").insert({ owner_id: user.id, number, kind, status: "finalized", student_id: studentId ?? null, period_start: periodStart.toISOString(), period_end: periodEnd.toISOString(), tutor_snapshot: settings, recipient_snapshot: recipient, total_cents: totalCents, issued_at: new Date().toISOString(), due_at: dueAt.toISOString() }).select("id").single();
  if (error) throw error;
  const lines = lessons.map((lesson) => ({ invoice_id: invoiceRow.id, lesson_id: lesson.id, student_name: lesson.studentName, lesson_date: lesson.startsAt, duration_minutes: lesson.durationMinutes, lesson_status: lesson.status, amount_cents: lesson.rateCents }));
  const { error: lineError } = await supabase.from("invoice_lines").insert(lines);
  if (lineError) { await supabase.from("invoices").delete().eq("id", invoiceRow.id); throw lineError; }
  await supabase.from("lessons").update({ invoiced_at: new Date().toISOString() }).in("id", lessons.map((lesson) => lesson.id));
  const invoice = await getInvoice(invoiceRow.id) as Invoice;
  if (invoice) {
    const buffer = await renderInvoicePdf(invoice, settings);
    const path = `${user.id}/${invoiceRow.id}.pdf`;
    const { error: uploadError } = await supabase.storage.from("invoices").upload(path, buffer, { contentType: "application/pdf", upsert: true });
    if (!uploadError) await supabase.from("invoices").update({ pdf_path: path }).eq("id", invoiceRow.id);
  }
  redirect(`/invoices/${invoiceRow.id}`);
}

export async function saveDraftInvoice(formData: FormData) {
  if (!isSupabaseConfigured()) redirect("/invoices");
  const user = await requireUser();
  const month = z.string().regex(/^\d{4}-\d{2}$/).parse(formData.get("month"));
  const kind = z.enum(["consolidated", "student"]).parse(formData.get("kind"));
  const rawStudentId = String(formData.get("studentId") ?? "");
  const studentId = kind === "student" ? z.string().uuid().parse(rawStudentId) : undefined;
  const [{ totalCents }, settings, student] = await Promise.all([
    getInvoicePreview(month, studentId),
    getBusinessSettings(),
    studentId ? getStudent(studentId) : Promise.resolve(null),
  ]);
  const recipient = kind === "consolidated"
    ? { name: settings.defaultPayerName, email: settings.defaultPayerEmail, address: settings.defaultPayerAddress }
    : { name: student?.guardianName || student?.displayName || "Client", email: student?.billingEmail || "", address: student?.billingAddress || "" };
  const periodStart = new Date(`${month}-01T00:00:00+02:00`);
  const supabase = await createClient();
  const { data, error } = await supabase.from("invoices").insert({ owner_id: user.id, kind, status: "draft", student_id: studentId ?? null, period_start: periodStart.toISOString(), period_end: endOfMonth(periodStart).toISOString(), tutor_snapshot: settings, recipient_snapshot: recipient, total_cents: totalCents }).select("id").single();
  if (error) throw error;
  redirect(`/invoices/${data.id}`);
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
