import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decodeLessonHistoryCursor: vi.fn(),
  getLessonHistoryPage: vi.fn(),
  getStudent: vi.fn(),
  requireApprovedUser: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  AuthorizationError: class AuthorizationError extends Error {
    constructor(public status: number) { super(); }
  },
  requireApprovedUser: mocks.requireApprovedUser,
}));
vi.mock("@/lib/data", () => ({
  decodeLessonHistoryCursor: mocks.decodeLessonHistoryCursor,
  getLessonHistoryPage: mocks.getLessonHistoryPage,
  getStudent: mocks.getStudent,
}));
vi.mock("@/lib/supabase/server", () => ({ isSupabaseConfigured: () => true }));

import { GET } from "@/app/api/lesson-history/[studentId]/route";

const studentId = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ studentId }) };

describe("lesson history route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApprovedUser.mockResolvedValue({ user: { id: "owner" } });
    mocks.getStudent.mockResolvedValue({ id: studentId, deletedAt: "2026-08-01T00:00:00.000Z" });
    mocks.getLessonHistoryPage.mockResolvedValue({ lessons: [], nextCursor: null });
  });

  it("keeps approval checks and permits an archived student's preserved history", async () => {
    const response = await GET(new Request("https://example.test/api/lesson-history/student"), context);

    expect(response.status).toBe(200);
    expect(mocks.requireApprovedUser).toHaveBeenCalledOnce();
    expect(mocks.getStudent).toHaveBeenCalledWith(studentId, { includeArchived: true });
    expect(mocks.getLessonHistoryPage).toHaveBeenCalledWith({ studentId, cursor: undefined });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects malformed cursors before querying history", async () => {
    mocks.decodeLessonHistoryCursor.mockReturnValue(null);

    const response = await GET(new Request("https://example.test/api/lesson-history/student?cursor=bad"), context);

    expect(response.status).toBe(400);
    expect(mocks.getLessonHistoryPage).not.toHaveBeenCalled();
  });
});
