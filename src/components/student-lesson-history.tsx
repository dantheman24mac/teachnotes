"use client";

import { useState } from "react";
import { StatusChip } from "@/components/status-chip";
import { formatInWorkspaceTime } from "@/lib/timezone";
import type { Lesson } from "@/lib/types";

interface LessonHistoryResponse {
  lessons: Lesson[];
  nextCursor: string | null;
}

export function StudentLessonHistory({
  initialLessons,
  initialNextCursor,
  studentId,
  timezone,
}: {
  initialLessons: Lesson[];
  initialNextCursor: string | null;
  studentId: string;
  timezone: string;
}) {
  const [lessons, setLessons] = useState(initialLessons);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadOlder() {
    if (!nextCursor || loading) return;
    setLoading(true);
    setError("");
    try {
      const search = new URLSearchParams({ cursor: nextCursor });
      const response = await fetch(`/api/lesson-history/${encodeURIComponent(studentId)}?${search}`, {
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("History request failed");
      const page = await response.json() as LessonHistoryResponse;
      setLessons((current) => {
        const knownIds = new Set(current.map((lesson) => lesson.id));
        return [...current, ...page.lessons.filter((lesson) => !knownIds.has(lesson.id))];
      });
      setNextCursor(page.nextCursor);
    } catch {
      setError("Older notes could not be loaded. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!lessons.length) return <p className="empty-copy">No previous lesson notes.</p>;

  return <>
    <div className="note-timeline">{lessons.map((lesson) => <article key={lesson.id}>
      <time>{formatInWorkspaceTime(lesson.startsAt, timezone, { day: "numeric", month: "short", year: "numeric" })}</time>
      <div><StatusChip status={lesson.status} /><p>{lesson.notes}</p></div>
    </article>)}</div>
    {nextCursor && <button className="button-secondary full-width history-load-more" type="button" onClick={loadOlder} disabled={loading}>
      {loading ? "Loading…" : "Load older notes"}
    </button>}
    {error && <p className="history-load-error" role="alert">{error}</p>}
  </>;
}
