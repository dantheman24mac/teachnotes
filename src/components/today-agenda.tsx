"use client";

import { Check, ChevronRight, Clock3, FileText, MoreHorizontal, UserRoundCheck, UserRoundX } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cacheLessons, getCachedLessons, queueLessonPatch } from "@/lib/offline";
import { formatZar, STATUS_LABELS } from "@/lib/domain";
import type { Lesson, LessonStatus } from "@/lib/types";
import { StatusChip } from "./status-chip";
import { useOffline } from "./offline-provider";

const statuses: LessonStatus[] = ["attended", "no_show", "canceled_rescheduled"];

export function TodayAgenda({ initialLessons, monthEarnings, completedCount, billableCount }: { initialLessons: Lesson[]; monthEarnings: number; completedCount: number; billableCount: number }) {
  const [lessons, setLessons] = useState(initialLessons);
  const [editing, setEditing] = useState<string | null>(null);
  const { online, syncNow } = useOffline();

  useEffect(() => {
    void cacheLessons(initialLessons);
    if (!online && initialLessons.length === 0) {
      void getCachedLessons().then((cached) => {
        const today = new Date().toDateString();
        setLessons(cached.filter((lesson) => new Date(lesson.startsAt).toDateString() === today));
      });
    }
  }, [initialLessons, online]);

  async function updateLesson(lesson: Lesson, patch: Partial<Pick<Lesson, "status" | "notes" | "billingOverride">>) {
    const updated = await queueLessonPatch(lesson, patch);
    setLessons((current) => current.map((item) => item.id === lesson.id ? updated : item));
    if (online) void syncNow();
  }

  return (
    <>
      <div className="page-heading">
        <div><p className="eyebrow">Your teaching day</p><h1>Today’s agenda</h1><p className="subtle">{new Intl.DateTimeFormat("en-ZA", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</p></div>
        <Link href="/calendar" className="button-secondary"><Clock3 size={17} /> View calendar</Link>
      </div>
      <section className="metric-grid" aria-label="Month overview">
        <article className="metric-card metric-featured"><span>Month-to-date</span><strong>{formatZar(monthEarnings)}</strong><small>{billableCount} billable lessons</small></article>
        <article className="metric-card"><span>Completed</span><strong>{completedCount}</strong><small>lessons this month</small></article>
        <article className="metric-card"><span>Today</span><strong>{lessons.length}</strong><small>{lessons.filter((lesson) => lesson.status === "scheduled").length} still to record</small></article>
      </section>
      <section className="section-block">
        <div className="section-heading"><div><h2>Lessons</h2><p>Record the essentials while the lesson is fresh.</p></div><span className="date-chip">{lessons.length} today</span></div>
        <div className="agenda-list">
          {lessons.length === 0 && <div className="empty-state"><UserRoundCheck size={28} /><h3>No lessons today</h3><p>Your cached lessons will still appear here when you are offline.</p></div>}
          {lessons.map((lesson) => (
            <article className="agenda-card" key={lesson.id}>
              <div className="time-block"><strong>{new Intl.DateTimeFormat("en-ZA", { hour: "2-digit", minute: "2-digit" }).format(new Date(lesson.startsAt))}</strong><span>{lesson.durationMinutes} min</span></div>
              <div className="agenda-main">
                <div className="agenda-top"><div><h3>{lesson.studentName}</h3><div className="lesson-meta"><StatusChip status={lesson.status} /><span>{formatZar(lesson.rateCents)}</span></div></div><button className="icon-button" type="button" onClick={() => setEditing(editing === lesson.id ? null : lesson.id)} aria-label={`Quick edit ${lesson.studentName}`}><MoreHorizontal /></button></div>
                <p className="lesson-note"><FileText size={15} />{lesson.notes || "No lesson note yet."}</p>
                {editing === lesson.id && <div className="quick-editor">
                  <div className="status-buttons" role="group" aria-label="Attendance status">
                    {statuses.map((status) => <button type="button" className={lesson.status === status ? "selected" : ""} key={status} onClick={() => void updateLesson(lesson, { status })}>{status === "attended" ? <Check /> : status === "no_show" ? <UserRoundX /> : <Clock3 />}{STATUS_LABELS[status]}</button>)}
                  </div>
                  <label>Lesson note<textarea defaultValue={lesson.notes} onBlur={(event) => void updateLesson(lesson, { notes: event.target.value })} placeholder="What did you cover? What comes next?" /></label>
                  <p className="autosave-note">Saved to this device immediately. Syncs when online.</p>
                </div>}
              </div>
              <Link prefetch={false} href={`/lessons/${lesson.id}`} className="agenda-link" aria-label={`Open ${lesson.studentName} lesson`}><ChevronRight /></Link>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
