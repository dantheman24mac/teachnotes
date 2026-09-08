// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Lesson } from "@/lib/types";
import { LessonEditor } from "@/components/lesson-editor";
import { visibleTodayLessons } from "@/components/timezone-aware-today-agenda";

const offlineMocks = vi.hoisted(() => ({
  cacheLessons: vi.fn(async () => {}),
  getCachedLesson: vi.fn(async () => undefined),
  queueLessonPatch: vi.fn(),
}));

vi.mock("@/lib/offline", () => offlineMocks);
vi.mock("@/components/offline-provider", () => ({
  useOffline: () => ({ online: false, ready: true, syncNow: vi.fn(), userId: "test-user" }),
}));

const initialLesson: Lesson = {
  id: "11111111-1111-4111-8111-111111111111",
  studentId: "22222222-2222-4222-8222-222222222222",
  studentName: "Test student",
  startsAt: "2026-09-07T10:00:00.000Z",
  durationMinutes: 60,
  rateCents: 50000,
  status: "scheduled",
  billingOverride: "default",
  notes: "",
  version: 1,
  syncRevision: 1,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LessonEditor", () => {
  it("keeps text typed while a save is in flight and queues only edited fields", async () => {
    let finishSave!: (lesson: Lesson) => void;
    offlineMocks.queueLessonPatch.mockReturnValueOnce(new Promise<Lesson>((resolve) => { finishSave = resolve; }));
    offlineMocks.queueLessonPatch.mockResolvedValueOnce({ ...initialLesson, notes: "Second draft" });
    render(<LessonEditor initialLesson={initialLesson} />);
    const notes = screen.getByRole("textbox", { name: "Lesson notes" });

    fireEvent.change(notes, { target: { value: "First draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save lesson" }));
    await waitFor(() => expect(offlineMocks.queueLessonPatch).toHaveBeenCalledTimes(1));
    expect(offlineMocks.queueLessonPatch).toHaveBeenNthCalledWith(1, "test-user", expect.objectContaining({ notes: "First draft" }), { notes: "First draft" });

    fireEvent.change(notes, { target: { value: "Second draft" } });
    finishSave({ ...initialLesson, notes: "First draft" });
    await waitFor(() => expect((notes as HTMLTextAreaElement).value).toBe("Second draft"));

    fireEvent.click(screen.getByRole("button", { name: "Save lesson" }));
    await waitFor(() => expect(offlineMocks.queueLessonPatch).toHaveBeenCalledTimes(2));
    expect(offlineMocks.queueLessonPatch).toHaveBeenNthCalledWith(2, "test-user", expect.objectContaining({ notes: "Second draft" }), { notes: "Second draft" });
  });
});

describe("visibleTodayLessons", () => {
  it("does not restore a moved or deleted cached lesson while online", () => {
    const now = new Date("2026-09-07T12:00:00.000Z");
    const cached = [initialLesson, { ...initialLesson, id: "33333333-3333-4333-8333-333333333333", studentName: "Moved student" }];

    expect(visibleTodayLessons(cached, [initialLesson], true, "UTC", now)).toEqual([initialLesson]);
    expect(visibleTodayLessons(cached, [initialLesson], false, "UTC", now)).toEqual(cached);
  });
});
