"use server";

import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireApprovedUser } from "@/lib/auth";
import { getBusinessSettings, getStudent } from "@/lib/data";
import { buildSeriesReplacement, expandSeries } from "@/lib/recurrence";
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
    .select("id, series_id, starts_at, occurrence_key")
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
    const { error: updateError } = await supabase.rpc("reschedule_lesson_series", {
      p_lesson_id: lessonId,
      p_scope: "one",
      p_next_starts_at: next.toISOString(),
    });
    if (updateError) throw updateError;
  } else {
    const { data: series, error: seriesError } = await supabase
      .from("lesson_series")
      .select("starts_at_local, timezone, frequency, weekdays, week_starts_on, until, exclusions")
      .eq("id", current.series_id)
      .eq("active", true)
      .is("deleted_at", null)
      .single();
    if (seriesError) throw seriesError;

    const sourceTime = new Date(current.occurrence_key ?? current.starts_at);
    const now = new Date();
    const cutoff = scope === "following" ? sourceTime : now;
    const expansionCutoff = sourceTime < cutoff ? sourceTime : cutoff;
    const horizon = new Date(now);
    horizon.setFullYear(horizon.getFullYear() + 1);
    const nextInSeriesTimezone = formatInTimeZone(next, series.timezone, "yyyy-MM-dd'T'HH:mm:ss");
    const replacement = buildSeriesReplacement(
      {
        startsAtLocal: series.starts_at_local,
        timezone: series.timezone,
        frequency: series.frequency,
        weekdays: series.weekdays,
        weekStartsOn: series.week_starts_on,
        until: series.until,
        exclusions: series.exclusions ?? [],
      },
      sourceTime,
      nextInSeriesTimezone,
      expansionCutoff,
      horizon,
    );
    const occurrences = replacement.occurrences.filter((item) => new Date(item.startsAt) >= now);
    const selectedOccurrence = occurrences.find((item) => item.sourceKey === sourceTime.toISOString());
    if (!selectedOccurrence || selectedOccurrence.startsAt !== next.toISOString()) {
      throw new Error("The selected lesson does not fit the replacement schedule");
    }
    const materializeFrom = occurrences[0].startsAt;
    const { error: updateError } = await supabase.rpc("reschedule_lesson_series", {
      p_lesson_id: lessonId,
      p_scope: scope,
      p_next_starts_at: next.toISOString(),
      p_cutoff: cutoff.toISOString(),
      p_materialize_from: materializeFrom,
      p_new_starts_at_local: replacement.startsAtLocal,
      p_new_timezone: replacement.timezone,
      p_new_frequency: replacement.frequency,
      p_new_weekdays: replacement.weekdays,
      p_new_week_starts_on: replacement.weekStartsOn,
      p_new_until: replacement.until,
      p_new_exclusions: replacement.exclusions,
      p_occurrences: occurrences,
    });
    if (updateError) throw updateError;
  }

  revalidatePath(`/lessons/${lessonId}`);
  revalidatePath("/calendar");
  revalidatePath("/today");
}
