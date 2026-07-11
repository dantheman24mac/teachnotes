"use client";

import { Check, CloudOff, Save } from "lucide-react";
import { useState } from "react";
import { STATUS_LABELS, formatZar, isBillable } from "@/lib/domain";
import { queueLessonPatch } from "@/lib/offline";
import type { BillingOverride, Lesson, LessonStatus } from "@/lib/types";
import { useOffline } from "./offline-provider";

export function LessonEditor({ initialLesson }: { initialLesson: Lesson }) {
  const [lesson, setLesson] = useState(initialLesson);
  const [saved, setSaved] = useState(false);
  const { online, syncNow } = useOffline();
  async function save() {
    const updated = await queueLessonPatch(initialLesson, { status: lesson.status, notes: lesson.notes, billingOverride: lesson.billingOverride });
    setLesson(updated); setSaved(true); setTimeout(() => setSaved(false), 1800);
    if (online) void syncNow();
  }
  return <section className="section-card lesson-editor"><div className="section-heading"><div><h2>Lesson outcome</h2><p>Changes save to this device first.</p></div>{!online && <span className="offline-badge"><CloudOff size={14} /> Offline</span>}</div><fieldset><legend>Attendance</legend><div className="outcome-grid">{(["attended", "no_show", "canceled_rescheduled"] as LessonStatus[]).map((status) => <button type="button" key={status} onClick={() => setLesson({ ...lesson, status })} className={lesson.status === status ? "selected" : ""}><span className="radio-dot">{lesson.status === status && <Check size={13} />}</span><span><strong>{STATUS_LABELS[status]}</strong><small>{status === "attended" ? "Lesson completed" : status === "no_show" ? "Student did not attend" : "Cancelled or moved"}</small></span></button>)}</div></fieldset><label>Lesson notes<textarea rows={8} value={lesson.notes} onChange={(event) => setLesson({ ...lesson, notes: event.target.value })} placeholder="What did you cover? What should happen next?" /></label><div className="billing-row"><div><strong>Bill this lesson</strong><span>{formatZar(lesson.rateCents)} · {lesson.durationMinutes} minutes</span></div><select aria-label="Billing rule" value={lesson.billingOverride} onChange={(event) => setLesson({ ...lesson, billingOverride: event.target.value as BillingOverride })}><option value="default">Use status default ({isBillable(lesson.status, "default") ? "billable" : "not billable"})</option><option value="billable">Billable override</option><option value="non_billable">Non-billable override</option></select></div><button className="button-primary" onClick={() => void save()} type="button"><Save size={17} />{saved ? "Saved" : "Save lesson"}</button></section>;
}
