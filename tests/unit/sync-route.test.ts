import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApprovedUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  AuthorizationError: class AuthorizationError extends Error {
    constructor(public status: number) { super(); }
  },
  requireApprovedUser: mocks.requireApprovedUser,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc: mocks.rpc })),
  isSupabaseConfigured: () => true,
}));

import { POST } from "@/app/api/sync/route";
import type { SyncOperation } from "@/lib/types";

function operation(overrides: Partial<SyncOperation> = {}): SyncOperation {
  return {
    id: crypto.randomUUID(),
    lessonId: crypto.randomUUID(),
    baseVersion: 1,
    patch: { notes: "Covered fractions" },
    clientTimestamp: "2026-09-07T10:00:00.000Z",
    ...overrides,
  };
}

function lessonRow(lessonId: string) {
  return {
    id: lessonId,
    student_id: crypto.randomUUID(),
    starts_at: "2026-09-07T10:00:00.000Z",
    duration_minutes: 60,
    rate_cents: 50000,
    status: "attended",
    billing_override: "default",
    notes: "Covered fractions",
    version: 2,
    sync_revision: 9,
    invoiced_at: null,
    students: { display_name: "Test student" },
  };
}

function post(operations: SyncOperation[]) {
  return new Request("https://example.test/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operations }),
  });
}

describe("sync route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApprovedUser.mockResolvedValue({ user: { id: "owner" } });
  });

  it("rejects operations for deleted lessons without failing the rest of the batch", async () => {
    const dead = operation();
    const live = operation();
    mocks.rpc
      .mockResolvedValueOnce({
        data: null,
        error: { message: "lesson not found", details: null, hint: null, code: "P0001" },
      })
      .mockResolvedValueOnce({ data: { status: "applied", lesson: lessonRow(live.lessonId) }, error: null });

    const response = await POST(post([dead, live]));
    const body = (await response.json()) as {
      applied: Array<{ operationId: string }>;
      conflicts: unknown[];
      rejected: Array<{ operationId: string; lessonId: string; reason: string }>;
    };

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(body.applied.map((item) => item.operationId)).toEqual([live.id]);
    expect(body.conflicts).toEqual([]);
    expect(body.rejected).toEqual([{ operationId: dead.id, lessonId: dead.lessonId, reason: "lesson_not_found" }]);
  });

  it("still fails the batch on transient database errors", async () => {
    const first = operation();
    const second = operation();
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "connection failed", details: null, hint: null, code: "XX000" },
    });

    const response = await POST(post([first, second]));

    expect(response.status).toBe(500);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("rejects empty patches before touching the database", async () => {
    const response = await POST(post([operation({ patch: {} })]));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
