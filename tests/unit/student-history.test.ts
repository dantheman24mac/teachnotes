// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lesson } from "@/lib/types";

const mocks = vi.hoisted(() => ({ lessons: [] as Lesson[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/demo-data", () => ({
  demoInvoices: [],
  demoLessons: mocks.lessons,
  demoSettings: { timezone: "Africa/Johannesburg" },
  demoStudents: [],
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  isSupabaseConfigured: () => false,
}));
vi.mock("@/lib/auth", () => ({ requireApprovedUser: vi.fn() }));

import { StudentLessonHistory } from "@/components/student-lesson-history";
import {
  decodeLessonHistoryCursor,
  getLessonHistoryPage,
  getPreviousLessonNotes,
  getUpcomingLessons,
} from "@/lib/data";

const studentId = "11111111-1111-4111-8111-111111111111";

function lesson(index: number, startsAt: string, notes = `Note ${index}`): Lesson {
  return {
    id: `${index.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
    studentId,
    studentName: "Student",
    startsAt,
    durationMinutes: 60,
    rateCents: 10000,
    status: "attended",
    billingOverride: "default",
    notes,
    version: 1,
    syncRevision: index,
  };
}

describe("student lesson history queries", () => {
  beforeEach(() => mocks.lessons.splice(0));

  it("finds upcoming lessons independently of more than 50 historical lessons", async () => {
    const now = new Date("2026-09-05T10:00:00.000Z");
    for (let index = 1; index <= 60; index += 1) {
      mocks.lessons.push(lesson(index, new Date(now.getTime() - index * 60_000).toISOString()));
    }
    mocks.lessons.push(
      lesson(61, "2026-09-06T10:00:00.000Z"),
      lesson(62, "2026-09-05T11:00:00.000Z"),
    );

    const [upcoming, history] = await Promise.all([
      getUpcomingLessons(studentId, now.toISOString()),
      getLessonHistoryPage({ studentId, before: now.toISOString() }),
    ]);

    expect(upcoming.map((item) => item.id)).toEqual([lesson(62, "").id, lesson(61, "").id]);
    expect(history.lessons).toHaveLength(20);
    expect(history.lessons[0].id).toBe(lesson(1, "").id);
  });

  it("filters note-less lessons before applying the page limit", async () => {
    const now = new Date("2026-09-05T10:00:00.000Z");
    for (let index = 1; index <= 25; index += 1) {
      mocks.lessons.push(lesson(index, new Date(now.getTime() - index * 60_000).toISOString(), ""));
    }
    for (let index = 26; index <= 50; index += 1) {
      mocks.lessons.push(lesson(index, new Date(now.getTime() - index * 60_000).toISOString()));
    }

    const page = await getLessonHistoryPage({ studentId, before: now.toISOString() });

    expect(page.lessons).toHaveLength(20);
    expect(page.lessons.every((item) => Boolean(item.notes))).toBe(true);
    expect(page.lessons[0].id).toBe(lesson(26, "").id);
  });

  it("pages through duplicate timestamps without duplicates or skipped notes", async () => {
    const duplicateTime = "2026-09-04T10:00:00.000Z";
    for (let index = 1; index <= 25; index += 1) mocks.lessons.push(lesson(index, duplicateTime));
    for (let index = 26; index <= 35; index += 1) {
      mocks.lessons.push(lesson(index, `2026-09-03T${String(35 - index).padStart(2, "0")}:00:00.000Z`));
    }

    const first = await getLessonHistoryPage({ studentId, before: "2026-09-05T10:00:00.000Z" });
    const cursor = decodeLessonHistoryCursor(first.nextCursor!);
    const second = await getLessonHistoryPage({ studentId, cursor: cursor! });
    const ids = [...first.lessons, ...second.lessons].map((item) => item.id);

    expect(first.lessons).toHaveLength(20);
    expect(second.lessons).toHaveLength(15);
    expect(new Set(ids).size).toBe(35);
    expect(ids).toEqual([...mocks.lessons].sort((left, right) =>
      right.startsAt.localeCompare(left.startsAt) || right.id.localeCompare(left.id),
    ).map((item) => item.id));
  });

  it("returns the latest notes strictly before a lesson", async () => {
    const lessonTime = new Date("2026-09-05T10:00:00.000Z");
    for (let index = 1; index <= 60; index += 1) {
      mocks.lessons.push(lesson(index, new Date(lessonTime.getTime() - index * 60_000).toISOString()));
    }
    mocks.lessons.push(lesson(61, lessonTime.toISOString(), "Same-time note"));

    const notes = await getPreviousLessonNotes(studentId, lessonTime.toISOString());

    expect(notes).toHaveLength(20);
    expect(notes.map((item) => item.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => lesson(index + 1, "").id),
    );
  });
});

describe("student lesson history control", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("loads and appends an older page", async () => {
    const recent = lesson(1, "2026-09-04T10:00:00.000Z");
    const older = lesson(2, "2026-09-03T10:00:00.000Z");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ lessons: [older], nextCursor: null })));
    vi.stubGlobal("fetch", fetchMock);

    render(createElement(StudentLessonHistory, {
      initialLessons: [recent],
      initialNextCursor: "cursor-one",
      studentId,
      timezone: "Africa/Johannesburg",
    }));
    fireEvent.click(screen.getByRole("button", { name: "Load older notes" }));

    await waitFor(() => expect(screen.getByText(older.notes)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Load older notes" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/lesson-history/${studentId}?cursor=cursor-one`,
      { credentials: "same-origin" },
    );
  });
});
