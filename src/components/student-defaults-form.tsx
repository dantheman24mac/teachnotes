"use client";

import { useActionState } from "react";
import { updateStudentDefaults, type StudentDefaultsState } from "@/app/actions";

const initialState: StudentDefaultsState = { status: "idle", message: "" };

export function StudentDefaultsForm({
  studentId,
  durationMinutes,
  rateCents,
}: {
  studentId: string;
  durationMinutes: number;
  rateCents: number;
}) {
  const [state, action, pending] = useActionState(updateStudentDefaults, initialState);
  return <form className="stack-form" action={action}>
    <input type="hidden" name="studentId" value={studentId} />
    <label>Default duration<input name="duration" type="number" min="15" max="240" step="5" defaultValue={durationMinutes} required /></label>
    <label>Lesson amount (R)<input name="rateRand" type="number" min="0" step="0.01" defaultValue={(rateCents / 100).toFixed(2)} required /></label>
    <label className="check-row"><input name="applyFuture" type="checkbox" />Apply to future scheduled lessons</label>
    <button className="button-primary" disabled={pending} type="submit">{pending ? "Saving defaults…" : "Save defaults"}</button>
    {state.message && <p className={state.status === "success" ? "form-success" : "form-error"} aria-live="polite">{state.message}</p>}
  </form>;
}
