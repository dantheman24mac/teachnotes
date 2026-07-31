"use client";

import { Archive, RotateCcw } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { archiveStudent, restoreStudent, type StudentArchiveState } from "@/app/actions";

const initialState: StudentArchiveState = { message: "" };

function SubmitButton({ mode }: { mode: "archive" | "restore" }) {
  const { pending } = useFormStatus();
  return <button className={mode === "archive" ? "danger-button full-width" : "button-primary full-width"} disabled={pending} type="submit">
    {mode === "archive" ? <Archive size={16} /> : <RotateCcw size={16} />}
    {pending ? (mode === "archive" ? "Archiving…" : "Restoring…") : (mode === "archive" ? "Confirm archive" : "Restore student")}
  </button>;
}

export function ArchiveStudentControl({ studentId }: { studentId: string }) {
  const [state, action] = useActionState(archiveStudent, initialState);
  return <details className="archive-details">
    <summary><Archive size={16} /> Archive student</summary>
    <div>
      <p>This archives the student, all recurring series, and future scheduled lessons that have not been invoiced. Lesson and invoice history is kept.</p>
      <form action={action}>
        <input name="studentId" type="hidden" value={studentId} />
        <SubmitButton mode="archive" />
      </form>
      {state.message && <p className="form-error" aria-live="polite">{state.message}</p>}
    </div>
  </details>;
}

export function RestoreStudentControl({ studentId }: { studentId: string }) {
  const [state, action] = useActionState(restoreStudent, initialState);
  return <div className="restore-student">
    <p>Restoring makes this student active again. Old recurring series and removed future lessons stay archived, so create a new series if teaching resumes.</p>
    <form action={action}>
      <input name="studentId" type="hidden" value={studentId} />
      <SubmitButton mode="restore" />
    </form>
    {state.message && <p className="form-error" aria-live="polite">{state.message}</p>}
  </div>;
}
