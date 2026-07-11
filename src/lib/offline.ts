"use client";

import { openDB, type DBSchema } from "idb";
import type { Lesson, Student, SyncConflict, SyncOperation } from "./types";

interface TeachNotesDB extends DBSchema {
  lessons: { key: string; value: Lesson; indexes: { "by-start": string } };
  students: { key: string; value: Student };
  outbox: { key: string; value: SyncOperation; indexes: { "by-created": string } };
  conflicts: { key: string; value: SyncConflict };
  meta: { key: string; value: { key: string; value: number | string } };
}

const database = () =>
  openDB<TeachNotesDB>("teachnotes", 1, {
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

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("teachnotes:sync"));
}

export async function cacheLessons(lessons: Lesson[]) {
  const db = await database();
  const tx = db.transaction("lessons", "readwrite");
  await Promise.all([...lessons.map((lesson) => tx.store.put(lesson)), tx.done]);
}

export async function cacheStudents(students: Student[]) {
  const db = await database();
  const tx = db.transaction("students", "readwrite");
  await Promise.all([...students.map((student) => tx.store.put(student)), tx.done]);
}

export async function getCachedLessons() {
  return (await database()).getAll("lessons");
}

export async function queueLessonPatch(lesson: Lesson, patch: SyncOperation["patch"]) {
  const db = await database();
  const updated = { ...lesson, ...patch } as Lesson;
  const operation: SyncOperation = {
    id: crypto.randomUUID(),
    lessonId: lesson.id,
    baseVersion: lesson.version,
    patch,
    clientTimestamp: new Date().toISOString(),
  };
  const tx = db.transaction(["lessons", "outbox"], "readwrite");
  await Promise.all([tx.objectStore("lessons").put(updated), tx.objectStore("outbox").put(operation), tx.done]);
  notify();
  return updated;
}

export async function pendingCount() {
  return (await database()).count("outbox");
}

export async function getConflicts() {
  return (await database()).getAll("conflicts");
}

export async function resolveConflict(operationId: string, resolution: "server" | "local") {
  const db = await database();
  const conflict = await db.get("conflicts", operationId);
  if (!conflict) return;
  const tx = db.transaction(["lessons", "conflicts", "outbox"], "readwrite");
  if (resolution === "server") {
    await tx.objectStore("lessons").put(conflict.serverLesson);
  } else {
    await tx.objectStore("outbox").put({
      ...conflict.operation,
      id: crypto.randomUUID(),
      baseVersion: conflict.serverLesson.version,
      clientTimestamp: new Date().toISOString(),
    });
  }
  await tx.objectStore("conflicts").delete(operationId);
  await tx.done;
  notify();
}

export async function flushOutbox() {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const db = await database();
  const operations = await db.getAllFromIndex("outbox", "by-created");
  if (!operations.length) return;
  const response = await fetch("/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operations }),
  });
  if (!response.ok) throw new Error("Sync is temporarily unavailable");
  const result = (await response.json()) as {
    applied: Array<{ operationId: string; lesson: Lesson }>;
    conflicts: SyncConflict[];
  };
  const tx = db.transaction(["lessons", "outbox", "conflicts"], "readwrite");
  for (const item of result.applied) {
    await tx.objectStore("lessons").put(item.lesson);
    await tx.objectStore("outbox").delete(item.operationId);
  }
  for (const conflict of result.conflicts) {
    await tx.objectStore("conflicts").put(conflict);
    await tx.objectStore("outbox").delete(conflict.operation.id);
  }
  await tx.done;
  notify();
}

export async function clearOfflineData() {
  const db = await database();
  const tx = db.transaction(["lessons", "students", "outbox", "conflicts", "meta"], "readwrite");
  await Promise.all([...Array.from(tx.objectStoreNames).map((name) => tx.objectStore(name).clear()), tx.done]);
  notify();
}
