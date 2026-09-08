"use client";

import { Save } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { updateStudent, type StudentProfileState } from "@/app/actions";
import type { Student } from "@/lib/types";

const initialState: StudentProfileState = { message: "" };

export function StudentProfileForm({ student }: { student: Student }) {
  const [state, action, pending] = useActionState(updateStudent, initialState);
  return <form className="section-card stack-form student-profile-form" action={action}>
    <input name="studentId" type="hidden" value={student.id} />
    <label>Student name<input name="displayName" defaultValue={student.displayName} minLength={2} maxLength={200} required /></label>
    <label>Billing contact<input name="guardianName" defaultValue={student.guardianName ?? ""} placeholder="Parent, guardian or client" /></label>
    <label>Billing email<input name="billingEmail" defaultValue={student.billingEmail ?? ""} type="email" placeholder="accounts@example.com" /></label>
    <label>Billing address<textarea name="billingAddress" defaultValue={student.billingAddress ?? ""} rows={4} /></label>
    {state.message && <p className="form-error" aria-live="polite">{state.message}</p>}
    <div className="profile-form-actions">
      <Link className="button-secondary" href={`/students/${student.id}`}>Cancel</Link>
      <button className="button-primary" disabled={pending} type="submit"><Save size={17} />{pending ? "Saving…" : "Save student"}</button>
    </div>
  </form>;
}
