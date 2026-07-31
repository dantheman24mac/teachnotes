"use server";

import { fromZonedTime } from "date-fns-tz";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireApprovedUser } from "@/lib/auth";
import { getBusinessSettings, getStudent } from "@/lib/data";
import { expandSeries } from "@/lib/recurrence";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

async function requireUser() {
  return (await requireApprovedUser()).user;
}

export async function createLessonSeries(formData: FormData) {
  if (!isSupabaseConfigured()) {
    revalidatePath("/calendar");
    return;
  }

  const user = await requireUser();
  const studentId = z.string().uuid().parse(formData.get("studentId"));
  const startsAtLocal = z.string().min(10).parse(formData.get("startsAtLocal"));
  const frequency = z.enum(["weekly", "fortnightly"]).parse(formData.get("frequency"));
  const weekdays = formData.getAll("weekdays").map(Number);
  const until = String(formData.get("until") ?? "") || null;
  const exclusions = String(formData.get("exclusions") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  const [student, settings] = await Promise.all([getStudent(studentId), getBusinessSettings()]);
  if (!student || weekdays.length === 0) throw new Error("Choose a student and at least one weekday");

  const supabase = await createClient();
  const { data: series, error } = await supabase
    .from("lesson_series")
    .insert({
      owner_id: user.id,
      student_id: studentId,
      starts_at_local: startsAtLocal,
      timezone: settings.timezone,
      frequency,
      weekdays,
      until,
      exclusions,
    })
    .select("id")
    .single();
  if (error) throw error;

  const occurrences = expandSeries({
    startsAtLocal,
    timezone: settings.timezone,
    frequency,
    weekdays,
    until,
    exclusions,
  });
  const rows = occurrences.map((date) => ({
    owner_id: user.id,
    student_id: studentId,
    series_id: series.id,
    occurrence_key: date.toISOString(),
    starts_at: date.toISOString(),
    duration_minutes: student.defaultDurationMinutes,
    rate_cents: student.defaultRateCents,
  }));

  for (let offset = 0; offset < rows.length; offset += 500) {
    const { error: insertError } = await supabase
      .from("lessons")
      .upsert(rows.slice(offset, offset + 500), { onConflict: "series_id,occurrence_key", ignoreDuplicates: true });
    if (insertError) throw insertError;
  }

  revalidatePath("/calendar");
  revalidatePath("/today");
}

export async function rescheduleLesson(formData: FormData) {
  if (!isSupabaseConfigured()) {
    revalidatePath("/calendar");
    return;
  }

  await requireUser();
  const lessonId = z.string().uuid().parse(formData.get("lessonId"));
  const nextLocal = z.string().min(10).parse(formData.get("startsAtLocal"));
  const scope = z.enum(["one", "following", "all_future"]).parse(formData.get("scope"));
  const settings = await getBusinessSettings();
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

  const next = fromZonedTime(nextLocal, settings.timezone);
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
