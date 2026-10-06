import "fake-indexeddb/auto";
import { openDB } from "idb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cacheLessons,
  flushOutbox,
  getCachedLesson,
  offlineDatabaseName,
  pendingCount,
  prepareOfflineUser,
  queueLessonPatch,
} from "@/lib/offline";
import type { Lesson, SyncOperation } from "@/lib/types";

const lesson = (overrides: Partial<Lesson> = {}): Lesson => ({
  id: crypto.randomUUID(),
  studentId: crypto.randomUUID(),
  studentName: "Test student",
  startsAt: "2026-09-07T10:00:00.000Z",
  durationMinutes: 60,
  rateCents: 50000,
  status: "scheduled",
  billingOverride: "default",
  notes: "",
  version: 1,
  syncRevision: 1,
  ...overrides,
});

function userId() {
  return crypto.randomUUID();
}

function successfulSync() {
  const serverLessons = new Map<string, Lesson>();
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const operations = (JSON.parse(String(init?.body)) as { operations: SyncOperation[] }).operations;
    const applied = operations.map((operation) => {
      const current = serverLessons.get(operation.lessonId) ?? lesson({ id: operation.lessonId });
      const updated = { ...current, ...operation.patch, version: current.version + 1, syncRevision: current.syncRevision + 1 };
      serverLessons.set(operation.lessonId, updated);
      return { operationId: operation.id, lesson: updated };
    });
    return Response.json({ applied, conflicts: [] });
  });
}

describe("offline lesson sync", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  });

  it("keeps consecutive attendance and note saves without self-conflicts", async () => {
    const user = userId();
    const initial = lesson();
    await prepareOfflineUser(user, false);
    await cacheLessons(user, [initial]);
    await queueLessonPatch(user, initial, { status: "attended" });
    await queueLessonPatch(user, initial, { notes: "Covered long division" });
    vi.stubGlobal("fetch", successfulSync());

    await flushOutbox(user);

    expect(await getCachedLesson(user, initial.id)).toMatchObject({ status: "attended", notes: "Covered long division", version: 3 });
    expect(await pendingCount(user)).toBe(0);
  });

  it("syncs queues larger than the API's 100-operation limit", async () => {
    const user = userId();
    const initial = lesson();
    await prepareOfflineUser(user, false);
    await cacheLessons(user, [initial]);
    for (let index = 0; index < 205; index += 1) await queueLessonPatch(user, initial, { notes: `Note ${index}` });
    const fetchMock = successfulSync();
    vi.stubGlobal("fetch", fetchMock);

    await flushOutbox(user);

    expect(fetchMock.mock.calls.map(([, init]) => (JSON.parse(String(init?.body)) as { operations: unknown[] }).operations.length)).toEqual([100, 100, 5]);
    expect(await getCachedLesson(user, initial.id)).toMatchObject({ notes: "Note 204", version: 206 });
  });

  it("preserves an edit queued while an earlier request is in flight", async () => {
    const user = userId();
    const initial = lesson();
    await prepareOfflineUser(user, false);
    await cacheLessons(user, [initial]);
    const first = await queueLessonPatch(user, initial, { status: "attended" });
    let finishFirst!: (response: Response) => void;
    let finishSecond!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => { finishFirst = resolve; });
    const secondResponse = new Promise<Response>((resolve) => { finishSecond = resolve; });
    const fetchMock = vi.fn().mockReturnValueOnce(firstResponse).mockReturnValueOnce(secondResponse);
    vi.stubGlobal("fetch", fetchMock);

    const flushing = flushOutbox(user);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const second = await queueLessonPatch(user, first, { notes: "Typed during sync" });
    const firstOperation = (JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { operations: SyncOperation[] }).operations[0];
    finishFirst(Response.json({ applied: [{ operationId: firstOperation.id, lesson: lesson({ id: initial.id, status: "attended", version: 2, syncRevision: 2 }) }], conflicts: [] }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await getCachedLesson(user, initial.id)).toMatchObject({ status: "attended", notes: "Typed during sync" });
    const secondOperation = (JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as { operations: SyncOperation[] }).operations[0];
    finishSecond(Response.json({ applied: [{ operationId: secondOperation.id, lesson: lesson({ id: initial.id, status: "attended", notes: "Typed during sync", version: 3, syncRevision: 3 }) }], conflicts: [] }));
    await flushing;
    expect(second.notes).toBe("Typed during sync");
    expect(await pendingCount(user)).toBe(0);
  });

  it("rejects a partial acknowledgement without changing the pending batch or caches", async () => {
    const user = userId();
    const initial = lesson();
    await prepareOfflineUser(user, false);
    await cacheLessons(user, [initial]);
    await queueLessonPatch(user, initial, { status: "attended" });
    const optimistic = await queueLessonPatch(user, initial, { notes: "Keep both edits" });
    let requestCount = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const operations = (JSON.parse(String(init?.body)) as { operations: SyncOperation[] }).operations;
      requestCount += 1;
      const acknowledged = requestCount === 1 ? operations.slice(0, 1) : operations;
      let serverLesson = initial;
      return Response.json({
        applied: acknowledged.map((operation) => {
          serverLesson = { ...serverLesson, ...operation.patch, version: serverLesson.version + 1, syncRevision: serverLesson.syncRevision + 1 };
          return { operationId: operation.id, lesson: serverLesson };
        }),
        conflicts: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(flushOutbox(user)).rejects.toThrow("Sync response did not match requested operations");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await pendingCount(user)).toBe(2);
    expect(await getCachedLesson(user, initial.id)).toEqual(optimistic);
    const db = await openDB(offlineDatabaseName(user));
    expect(await db.get("serverLessons", initial.id)).toEqual(initial);

    await flushOutbox(user);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await pendingCount(user)).toBe(0);
    expect(await getCachedLesson(user, initial.id)).toMatchObject({ status: "attended", notes: "Keep both edits", version: 3, syncRevision: 3 });
    db.close();
  });

  it("rejects an acknowledgement for an edit queued while the request is in flight", async () => {
    const user = userId();
    const initial = lesson();
    await prepareOfflineUser(user, false);
    await cacheLessons(user, [initial]);
    const first = await queueLessonPatch(user, initial, { status: "attended" });
    let finishRequest!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => { finishRequest = resolve; });
    const fetchMock = vi.fn().mockReturnValueOnce(response);
    vi.stubGlobal("fetch", fetchMock);

    const flushing = flushOutbox(user);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const optimistic = await queueLessonPatch(user, first, { notes: "Queued during sync" });
    const requested = (JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { operations: SyncOperation[] }).operations[0];
    const db = await openDB(offlineDatabaseName(user));
    const pending = (await db.getAll("outbox")) as SyncOperation[];
    const unsent = pending.find((operation) => operation.id !== requested.id)!;
    finishRequest(Response.json({
      applied: [
        { operationId: requested.id, lesson: lesson({ id: initial.id, status: "attended", version: 2, syncRevision: 2 }) },
        { operationId: unsent.id, lesson: lesson({ id: initial.id, status: "attended", notes: "Queued during sync", version: 3, syncRevision: 3 }) },
      ],
      conflicts: [],
    }));

    await expect(flushing).rejects.toThrow("Sync response did not match requested operations");
    expect(await pendingCount(user)).toBe(2);
    expect(await getCachedLesson(user, initial.id)).toEqual(optimistic);
    expect(await db.get("serverLessons", initial.id)).toEqual(initial);
    db.close();
  });

  it("does not let stale page data overwrite pending edits after reload", async () => {
    const user = userId();
    const initial = lesson();
    await prepareOfflineUser(user, false);
    await cacheLessons(user, [initial]);
    await queueLessonPatch(user, initial, { notes: "Offline note" });

    await cacheLessons(user, [{ ...initial, notes: "Stale server note" }]);

    expect(await getCachedLesson(user, initial.id)).toMatchObject({ notes: "Offline note" });
    expect(await pendingCount(user)).toBe(1);
  });

  it("uses the newest server snapshot when a batch contains an older retry result", async () => {
    const user = userId();
    const initial = lesson();
    await prepareOfflineUser(user, false);
    await cacheLessons(user, [initial]);
    await queueLessonPatch(user, initial, { status: "attended" });
    await queueLessonPatch(user, initial, { notes: "Local note" });
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const operations = (JSON.parse(String(init?.body)) as { operations: SyncOperation[] }).operations;
      return Response.json({
        applied: [
          { operationId: operations[0].id, lesson: lesson({ id: initial.id, status: "attended", notes: "Current server note", version: 4, syncRevision: 4 }) },
          { operationId: operations[1].id, lesson: lesson({ id: initial.id, notes: "Historical retry", version: 3, syncRevision: 3 }) },
        ],
        conflicts: [],
      });
    }));

    await flushOutbox(user);

    expect(await getCachedLesson(user, initial.id)).toMatchObject({ status: "attended", notes: "Current server note", version: 4, syncRevision: 4 });
  });

  it("removes a lost optimistic edit after its historical acknowledgement", async () => {
    const user = userId();
    const serverLesson = lesson({ notes: "Server winner", version: 5, syncRevision: 5 });
    await prepareOfflineUser(user, false);
    await cacheLessons(user, [serverLesson]);
    await queueLessonPatch(user, serverLesson, { notes: "Lost optimistic edit" });
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const [operation] = (JSON.parse(String(init?.body)) as { operations: SyncOperation[] }).operations;
      return Response.json({
        applied: [{ operationId: operation.id, lesson: lesson({ id: serverLesson.id, notes: "Old snapshot", version: 3, syncRevision: 3 }) }],
        conflicts: [],
      });
    }));

    await flushOutbox(user);

    expect(await getCachedLesson(user, serverLesson.id)).toMatchObject({ notes: "Server winner", version: 5, syncRevision: 5 });
    expect(await pendingCount(user)).toBe(0);
  });

  it("keeps demo edits across separate sync requests without shared server state", async () => {
    const user = userId();
    const initial = lesson({ syncRevision: 8 });
    await prepareOfflineUser(user, false);
    await cacheLessons(user, [initial]);
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const [operation] = (JSON.parse(String(init?.body)) as { operations: SyncOperation[] }).operations;
      return Response.json({
        applied: [{ operationId: operation.id, lesson: { ...initial, ...operation.patch, version: 2, syncRevision: 108 } }],
        conflicts: [],
      }, { headers: { "x-teachnotes-demo": "true" } });
    }));

    await queueLessonPatch(user, initial, { status: "attended" });
    await flushOutbox(user);
    await queueLessonPatch(user, initial, { notes: "Saved separately" });
    await flushOutbox(user);

    expect(await getCachedLesson(user, initial.id)).toMatchObject({ status: "attended", notes: "Saved separately" });
  });

  it("retries legacy conflicts under a new operation ID and keeps their save time", async () => {
    const user = userId();
    const name = offlineDatabaseName(user);
    const initial = lesson();
    const originalOperation: SyncOperation = {
      id: crypto.randomUUID(),
      lessonId: initial.id,
      baseVersion: 1,
      patch: { notes: "Recovered note" },
      clientTimestamp: "2026-09-06T08:00:00.000Z",
    };
    const legacy = await openDB(name, 1, {
      upgrade(db) {
        const lessons = db.createObjectStore("lessons", { keyPath: "id" });
        lessons.createIndex("by-start", "startsAt");
        db.createObjectStore("students", { keyPath: "id" });
        const outbox = db.createObjectStore("outbox", { keyPath: "id" });
        outbox.createIndex("by-created", "clientTimestamp");
        db.createObjectStore("conflicts", { keyPath: "operation.id" });
        db.createObjectStore("meta", { keyPath: "key" });
      },
    });
    await legacy.put("lessons", initial);
    await legacy.put("conflicts", { operation: originalOperation, serverLesson: { ...initial, version: 2 } });
    legacy.close();

    await prepareOfflineUser(user, false);

    const upgraded = await openDB(name);
    const retried = (await upgraded.getAll("outbox")) as SyncOperation[];
    expect(upgraded.version).toBe(2);
    expect(Array.from(upgraded.objectStoreNames)).toContain("serverLessons");
    expect(await upgraded.count("conflicts")).toBe(0);
    expect(retried).toHaveLength(1);
    expect(retried[0]).toMatchObject({ lessonId: initial.id, baseVersion: 2, clientTimestamp: originalOperation.clientTimestamp, patch: originalOperation.patch });
    expect(retried[0].id).not.toBe(originalOperation.id);
  });
});
