"use client";

import { Check, CloudOff, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { STATUS_LABELS, formatZar, isBillable } from "@/lib/domain";
import { cacheLessons, getCachedLesson, queueLessonPatch } from "@/lib/offline";
import type { BillingOverride, Lesson, LessonPatch, LessonStatus } from "@/lib/types";
import { useOffline } from "./offline-provider";

export function LessonEditor({ initialLesson }: { initialLesson: Lesson }) {
  const [lesson, setLesson] = useState(initialLesson);
  const [saved, setSaved] = useState(false);
  const dirtyFields = useRef(new Set<keyof LessonPatch>());
  const editRevision = useRef(0);
  const { online, ready, syncNow, userId } = useOffline();

  const loadCachedLesson = useCallback(async () => {
    const cached = await getCachedLesson(userId, initialLesson.id);
    if (!cached) return;
    setLesson((current) => {
      const next = { ...cached };
      for (const field of dirtyFields.current) Object.assign(next, { [field]: current[field] });
      return next;
    });
  }, [initialLesson.id, userId]);

  useEffect(() => {
    if (!ready) return;
    void cacheLessons(userId, [initialLesson]).then(loadCachedLesson);
    const refresh = () => void loadCachedLesson();
    window.addEventListener("teachnotes:sync", refresh);
    return () => window.removeEventListener("teachnotes:sync", refresh);
  }, [initialLesson, loadCachedLesson, ready, userId]);

  function change<Field extends keyof LessonPatch>(field: Field, value: LessonPatch[Field]) {
    dirtyFields.current.add(field);
    editRevision.current += 1;
    setSaved(false);
    setLesson((current) => ({ ...current, [field]: value }));
  }

  async function save() {
    const patch = Object.fromEntries([...dirtyFields.current].map((field) => [field, lesson[field]])) as LessonPatch;
    if (Object.keys(patch).length === 0) return;
    const savedRevision = editRevision.current;
    const updated = await queueLessonPatch(userId, lesson, patch);
    setLesson((current) => {
      const next = { ...updated };
      for (const field of dirtyFields.current) {
        if (field in patch && current[field] === patch[field]) dirtyFields.current.delete(field);
        else Object.assign(next, { [field]: current[field] });
      }
      return next;
    });
    if (editRevision.current === savedRevision) {
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    }
    if (online) void syncNow();
  }
  return <section className="section-card lesson-editor"><div className="section-heading"><div><h2>Lesson outcome</h2><p>Changes save to this device first.</p></div>{!online && <span className="offline-badge"><CloudOff size={14} /> Offline</span>}</div><fieldset><legend>Attendance</legend><div className="outcome-grid">{(["attended", "no_show", "canceled_rescheduled"] as LessonStatus[]).map((status) => <button type="button" key={status} onClick={() => change("status", status)} className={lesson.status === status ? "selected" : ""}><span className="radio-dot">{lesson.status === status && <Check size={13} />}</span><span><strong>{STATUS_LABELS[status]}</strong><small>{status === "attended" ? "Lesson completed" : status === "no_show" ? "Student did not attend" : "Cancelled or moved"}</small></span></button>)}</div></fieldset><label>Lesson notes<textarea rows={8} value={lesson.notes} onChange={(event) => change("notes", event.target.value)} placeholder="What did you cover? What should happen next?" /></label><div className="billing-row"><div><strong>Bill this lesson</strong><span>{formatZar(lesson.rateCents)} · {lesson.durationMinutes} minutes</span></div><select aria-label="Billing rule" value={lesson.billingOverride} onChange={(event) => change("billingOverride", event.target.value as BillingOverride)}><option value="default">Use status default ({isBillable(lesson.status, "default") ? "billable" : "not billable"})</option><option value="billable">Billable override</option><option value="non_billable">Non-billable override</option></select></div><button className="button-primary" onClick={() => void save()} type="button"><Save size={17} />{saved ? "Saved" : "Save lesson"}</button></section>;
}
