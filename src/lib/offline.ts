"use client";

import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Lesson, Student, SyncConflict, SyncOperation } from "./types";

interface TeachNotesDB extends DBSchema {
  lessons: { key: string; value: Lesson; indexes: { "by-start": string } };
  serverLessons: { key: string; value: Lesson };
  students: { key: string; value: Student };
  outbox: { key: string; value: SyncOperation; indexes: { "by-created": string } };
  conflicts: { key: string; value: SyncConflict };
  meta: { key: string; value: { key: string; value: number | string } };
}

const ACTIVE_USER_KEY = "teachnotes-active-user";
const LEGACY_DATABASE = "teachnotes";
const DATABASE_VERSION = 2;
const LAST_CLIENT_TIMESTAMP_KEY = "last-client-timestamp";
const databases = new Map<string, Promise<IDBPDatabase<TeachNotesDB>>>();
const preparations = new Map<string, Promise<void>>();

export function offlineDatabaseName(userId: string) {
  return `teachnotes-user-${userId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function openTeachNotesDatabase(name: string) {
  const existing = databases.get(name);
  if (existing) return existing;
  const opened = openDB<TeachNotesDB>(name, DATABASE_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const lessons = db.createObjectStore("lessons", { keyPath: "id" });
        lessons.createIndex("by-start", "startsAt");
        db.createObjectStore("students", { keyPath: "id" });
        const outbox = db.createObjectStore("outbox", { keyPath: "id" });
        outbox.createIndex("by-created", "clientTimestamp");
        db.createObjectStore("conflicts", { keyPath: "operation.id" });
        db.createObjectStore("meta", { keyPath: "key" });
      }
      if (oldVersion < 2) db.createObjectStore("serverLessons", { keyPath: "id" });
    },
  });
  databases.set(name, opened);
  return opened;
}

async function retryStoredConflicts(db: IDBPDatabase<TeachNotesDB>) {
  const conflicts = await db.getAll("conflicts");
  if (!conflicts.length) return;
  const tx = db.transaction(["outbox", "conflicts"], "readwrite");
  for (const conflict of conflicts) {
    await tx.objectStore("outbox").put({ ...conflict.operation, id: crypto.randomUUID(), baseVersion: conflict.serverLesson.version });
    await tx.objectStore("conflicts").delete(conflict.operation.id);
  }
  await tx.done;
}

async function legacyDatabaseExists() {
  if (!("databases" in indexedDB)) return true;
  const entries = await indexedDB.databases();
  return entries.some((entry) => entry.name === LEGACY_DATABASE);
}

async function migrateLegacyDatabase(userId: string) {
  const target = await openTeachNotesDatabase(offlineDatabaseName(userId));
  if (await target.get("meta", "legacy-migration-complete")) return;
  if (!(await legacyDatabaseExists())) {
    await target.put("meta", { key: "legacy-migration-complete", value: new Date().toISOString() });
    return;
  }

  const legacy = await openDB<TeachNotesDB>(LEGACY_DATABASE, DATABASE_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const lessons = db.createObjectStore("lessons", { keyPath: "id" });
        lessons.createIndex("by-start", "startsAt");
        db.createObjectStore("students", { keyPath: "id" });
        const outbox = db.createObjectStore("outbox", { keyPath: "id" });
        outbox.createIndex("by-created", "clientTimestamp");
        db.createObjectStore("conflicts", { keyPath: "operation.id" });
        db.createObjectStore("meta", { keyPath: "key" });
      }
      if (oldVersion < 2) db.createObjectStore("serverLessons", { keyPath: "id" });
    },
  });
  const [lessons, students, outbox, conflicts, meta] = await Promise.all([
    legacy.getAll("lessons"), legacy.getAll("students"), legacy.getAll("outbox"), legacy.getAll("conflicts"), legacy.getAll("meta"),
  ]);
  const tx = target.transaction(["lessons", "students", "outbox", "conflicts", "meta"], "readwrite");
  for (const lesson of lessons) await tx.objectStore("lessons").put(lesson);
  for (const student of students) await tx.objectStore("students").put(student);
  for (const operation of outbox) await tx.objectStore("outbox").put(operation);
  for (const conflict of conflicts) await tx.objectStore("conflicts").put(conflict);
  for (const item of meta) await tx.objectStore("meta").put(item);
  await tx.objectStore("meta").put({ key: "legacy-migration-complete", value: new Date().toISOString() });
  await tx.done;
  legacy.close();
  await deleteDB(LEGACY_DATABASE);
  await retryStoredConflicts(target);
}

export function prepareOfflineUser(userId: string, migrateLegacy: boolean) {
  const existing = preparations.get(userId);
  if (existing) return existing;
  const preparation = (async () => {
    if (migrateLegacy) await migrateLegacyDatabase(userId);
    const db = await openTeachNotesDatabase(offlineDatabaseName(userId));
    await retryStoredConflicts(db);
  })();
  preparations.set(userId, preparation);
  return preparation;
}

async function database(userId: string) {
  await preparations.get(userId);
  return openTeachNotesDatabase(offlineDatabaseName(userId));
}

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("teachnotes:sync"));
}

export async function setOfflineSessionMarker(userId: string) {
  localStorage.setItem(ACTIVE_USER_KEY, userId);
  navigator.serviceWorker?.controller?.postMessage({ type: "SET_ACTIVE_USER", userId });
}

export async function clearOfflineSessionMarker() {
  localStorage.removeItem(ACTIVE_USER_KEY);
  navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_ACTIVE_USER" });
}

export async function cacheLessons(userId: string, lessons: Lesson[]) {
  const db = await database(userId);
  const tx = db.transaction(["lessons", "serverLessons", "outbox"], "readwrite");
  const pending = await tx.objectStore("outbox").getAll();
  for (const lesson of lessons) {
    const storedServerLesson = await tx.objectStore("serverLessons").get(lesson.id);
    const serverLesson = storedServerLesson && storedServerLesson.syncRevision > lesson.syncRevision ? storedServerLesson : lesson;
    await tx.objectStore("serverLessons").put(serverLesson);
    await tx.objectStore("lessons").put(applyPendingPatches(serverLesson, pending.filter((operation) => operation.lessonId === lesson.id)));
  }
  await tx.done;
}

export async function cacheStudents(userId: string, students: Student[]) {
  const db = await database(userId);
  const tx = db.transaction("students", "readwrite");
  await Promise.all([...students.map((student) => tx.store.put(student)), tx.done]);
}

export async function getCachedLessons(userId: string) {
  return (await database(userId)).getAll("lessons");
}

export async function getCachedLesson(userId: string, lessonId: string) {
  return (await database(userId)).get("lessons", lessonId);
}

function compareOperations(left: SyncOperation, right: SyncOperation) {
  return left.clientTimestamp.localeCompare(right.clientTimestamp) || left.id.localeCompare(right.id);
}

function applyPendingPatches(lesson: Lesson, operations: SyncOperation[]) {
  return operations.sort(compareOperations).reduce((current, operation) => ({ ...current, ...operation.patch }), lesson);
}

export async function queueLessonPatch(userId: string, lesson: Lesson, patch: SyncOperation["patch"]) {
  const db = await database(userId);
  const tx = db.transaction(["lessons", "outbox", "meta"], "readwrite");
  const current = await tx.objectStore("lessons").get(lesson.id) ?? lesson;
  const lastTimestamp = await tx.objectStore("meta").get(LAST_CLIENT_TIMESTAMP_KEY);
  const timestamp = new Date(Math.max(Date.now(), Date.parse(String(lastTimestamp?.value ?? "")) + 1 || 0)).toISOString();
  const updated = { ...current, ...patch } as Lesson;
  const operation: SyncOperation = { id: crypto.randomUUID(), lessonId: lesson.id, baseVersion: current.version, patch, clientTimestamp: timestamp };
  await tx.objectStore("lessons").put(updated);
  await tx.objectStore("outbox").put(operation);
  await tx.objectStore("meta").put({ key: LAST_CLIENT_TIMESTAMP_KEY, value: timestamp });
  await tx.done;
  notify();
  return updated;
}

export async function pendingCount(userId: string) {
  return (await database(userId)).count("outbox");
}

export async function flushOutbox(userId: string) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const db = await database(userId);
  while (true) {
    const operations = (await db.getAllFromIndex("outbox", "by-created")).slice(0, 100);
    if (!operations.length) break;
    const response = await fetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operations }) });
    if (!response.ok) throw new Error("Sync is temporarily unavailable");
    const demoAcknowledgement = response.headers.get("x-teachnotes-demo") === "true";
    const result = (await response.json()) as { applied: Array<{ operationId: string; lesson: Lesson }>; conflicts: SyncConflict[] };
    const completed = new Set(result.applied.map((item) => item.operationId));
    for (const conflict of result.conflicts) completed.add(conflict.operation.id);
    if (completed.size !== operations.length || operations.some((operation) => !completed.has(operation.id))) {
      throw new Error("Sync response did not match requested operations");
    }

    const tx = db.transaction(["lessons", "serverLessons", "outbox", "conflicts"], "readwrite");
    for (const item of result.applied) await tx.objectStore("outbox").delete(item.operationId);
    for (const conflict of result.conflicts) {
      await tx.objectStore("outbox").delete(conflict.operation.id);
      await tx.objectStore("outbox").put({ ...conflict.operation, id: crypto.randomUUID(), baseVersion: conflict.serverLesson.version });
      await tx.objectStore("conflicts").delete(conflict.operation.id);
    }
    const remaining = await tx.objectStore("outbox").getAll();
    const serverLessons = new Map<string, Lesson>();
    for (const candidate of [...result.applied.map((item) => item.lesson), ...result.conflicts.map((conflict) => conflict.serverLesson)]) {
      const selected = serverLessons.get(candidate.id);
      if (!selected || candidate.syncRevision >= selected.syncRevision) serverLessons.set(candidate.id, candidate);
    }
    for (const [lessonId, serverLesson] of serverLessons) {
      const storedServerLesson = await tx.objectStore("serverLessons").get(lessonId);
      const cached = demoAcknowledgement ? await tx.objectStore("lessons").get(lessonId) : undefined;
      const acknowledged = cached
        ? { ...serverLesson, ...cached, version: Math.max(serverLesson.version, cached.version), syncRevision: Math.max(serverLesson.syncRevision, cached.syncRevision) }
        : serverLesson;
      const authoritative = storedServerLesson && storedServerLesson.syncRevision > acknowledged.syncRevision ? storedServerLesson : acknowledged;
      await tx.objectStore("serverLessons").put(authoritative);
      await tx.objectStore("lessons").put(applyPendingPatches(authoritative, remaining.filter((operation) => operation.lessonId === lessonId)));
    }
    await tx.done;
  }
  notify();
}

export async function clearOfflineData(userId?: string) {
  const resolvedUserId = userId ?? localStorage.getItem(ACTIVE_USER_KEY);
  if (resolvedUserId) {
    const db = await database(resolvedUserId);
    const tx = db.transaction(["lessons", "serverLessons", "students", "outbox", "conflicts", "meta"], "readwrite");
    await Promise.all([...Array.from(tx.objectStoreNames).map((name) => tx.objectStore(name).clear()), tx.done]);
  }
  await clearOfflineSessionMarker();
  notify();
}
