"use client";

import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Lesson, Student, SyncConflict, SyncOperation } from "./types";

interface TeachNotesDB extends DBSchema {
  lessons: { key: string; value: Lesson; indexes: { "by-start": string } };
  students: { key: string; value: Student };
  outbox: { key: string; value: SyncOperation; indexes: { "by-created": string } };
  conflicts: { key: string; value: SyncConflict };
  meta: { key: string; value: { key: string; value: number | string } };
}

const ACTIVE_USER_KEY = "teachnotes-active-user";
const LEGACY_DATABASE = "teachnotes";
const databases = new Map<string, Promise<IDBPDatabase<TeachNotesDB>>>();
const preparations = new Map<string, Promise<void>>();

export function offlineDatabaseName(userId: string) {
  return `teachnotes-user-${userId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function openTeachNotesDatabase(name: string) {
  const existing = databases.get(name);
  if (existing) return existing;
  const opened = openDB<TeachNotesDB>(name, 1, {
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
  databases.set(name, opened);
  return opened;
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

  const legacy = await openDB<TeachNotesDB>(LEGACY_DATABASE, 1, {
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
}

export function prepareOfflineUser(userId: string, migrateLegacy: boolean) {
  const existing = preparations.get(userId);
  if (existing) return existing;
  const preparation = (migrateLegacy ? migrateLegacyDatabase(userId) : openTeachNotesDatabase(offlineDatabaseName(userId)).then(() => undefined));
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
  const tx = db.transaction("lessons", "readwrite");
  await Promise.all([...lessons.map((lesson) => tx.store.put(lesson)), tx.done]);
}

export async function cacheStudents(userId: string, students: Student[]) {
  const db = await database(userId);
  const tx = db.transaction("students", "readwrite");
  await Promise.all([...students.map((student) => tx.store.put(student)), tx.done]);
}

export async function getCachedLessons(userId: string) {
  return (await database(userId)).getAll("lessons");
}

export function queueLessonPatch(userId: string, lesson: Lesson, patch: SyncOperation["patch"]): Promise<Lesson>;
export function queueLessonPatch(lesson: Lesson, patch: SyncOperation["patch"]): Promise<Lesson>;
export async function queueLessonPatch(userIdOrLesson: string | Lesson, lessonOrPatch: Lesson | SyncOperation["patch"], maybePatch?: SyncOperation["patch"]) {
  const userId = typeof userIdOrLesson === "string" ? userIdOrLesson : (localStorage.getItem(ACTIVE_USER_KEY) ?? "demo");
  const lesson = typeof userIdOrLesson === "string" ? lessonOrPatch as Lesson : userIdOrLesson;
  const patch = typeof userIdOrLesson === "string" ? maybePatch as SyncOperation["patch"] : lessonOrPatch as SyncOperation["patch"];
  const db = await database(userId);
  const updated = { ...lesson, ...patch } as Lesson;
  const operation: SyncOperation = { id: crypto.randomUUID(), lessonId: lesson.id, baseVersion: lesson.version, patch, clientTimestamp: new Date().toISOString() };
  const tx = db.transaction(["lessons", "outbox"], "readwrite");
  await Promise.all([tx.objectStore("lessons").put(updated), tx.objectStore("outbox").put(operation), tx.done]);
  notify();
  return updated;
}

export async function pendingCount(userId: string) {
  return (await database(userId)).count("outbox");
}

export async function getConflicts(userId: string) {
  return (await database(userId)).getAll("conflicts");
}

export async function resolveConflict(userId: string, operationId: string, resolution: "server" | "local") {
  const db = await database(userId);
  const conflict = await db.get("conflicts", operationId);
  if (!conflict) return;
  const tx = db.transaction(["lessons", "conflicts", "outbox"], "readwrite");
  if (resolution === "server") await tx.objectStore("lessons").put(conflict.serverLesson);
  else await tx.objectStore("outbox").put({ ...conflict.operation, id: crypto.randomUUID(), baseVersion: conflict.serverLesson.version, clientTimestamp: new Date().toISOString() });
  await tx.objectStore("conflicts").delete(operationId);
  await tx.done;
  notify();
}

export async function flushOutbox(userId: string) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const db = await database(userId);
  const operations = await db.getAllFromIndex("outbox", "by-created");
  if (!operations.length) return;
  const response = await fetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operations }) });
  if (!response.ok) throw new Error("Sync is temporarily unavailable");
  const result = (await response.json()) as { applied: Array<{ operationId: string; lesson: Lesson }>; conflicts: SyncConflict[] };
  const tx = db.transaction(["lessons", "outbox", "conflicts"], "readwrite");
  for (const item of result.applied) { await tx.objectStore("lessons").put(item.lesson); await tx.objectStore("outbox").delete(item.operationId); }
  for (const conflict of result.conflicts) { await tx.objectStore("conflicts").put(conflict); await tx.objectStore("outbox").delete(conflict.operation.id); }
  await tx.done;
  notify();
}

export async function clearOfflineData(userId?: string) {
  const resolvedUserId = userId ?? localStorage.getItem(ACTIVE_USER_KEY);
  if (resolvedUserId) {
    const db = await database(resolvedUserId);
    const tx = db.transaction(["lessons", "students", "outbox", "conflicts", "meta"], "readwrite");
    await Promise.all([...Array.from(tx.objectStoreNames).map((name) => tx.objectStore(name).clear()), tx.done]);
  }
  await clearOfflineSessionMarker();
  notify();
}
