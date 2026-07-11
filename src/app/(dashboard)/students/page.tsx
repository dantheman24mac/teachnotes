import { Plus, Search, UserRound } from "lucide-react";
import Link from "next/link";
import { createStudent } from "@/app/actions";
import { getStudents } from "@/lib/data";
import { formatZar } from "@/lib/domain";

export const metadata = { title: "Students" };

export default async function StudentsPage() {
  const students = await getStudents();
  return <><div className="page-heading"><div><p className="eyebrow">Your roster</p><h1>Students</h1><p className="subtle">Rates, billing contacts and lesson history in one place.</p></div></div><div className="two-column wide-main"><section className="section-card"><div className="search-row"><Search size={18} /><input aria-label="Search students" placeholder="Search your students" /></div><div className="student-list">{students.map((student) => <Link prefetch={false} href={`/students/${student.id}`} className="student-row" key={student.id}><span className="avatar">{student.displayName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><div><strong>{student.displayName}</strong><small>{student.guardianName || student.billingEmail || "No billing contact"}</small></div><div className="student-rate"><strong>{formatZar(student.defaultRateCents)}</strong><small>{student.defaultDurationMinutes} minutes</small></div></Link>)}</div></section><aside className="section-card sticky-card"><div className="card-icon"><UserRound /></div><h2>Add a student</h2><form className="stack-form" action={createStudent}><label>Student name<input name="displayName" required placeholder="Full name" /></label><div className="form-split"><label>Duration<input name="defaultDurationMinutes" type="number" min="15" step="5" defaultValue="60" required /></label><label>Lesson amount (R)<input name="defaultRateRand" type="number" min="0" step="0.01" defaultValue="450" required /></label></div><label>Billing contact<input name="guardianName" placeholder="Parent, guardian or client" /></label><label>Billing email<input name="billingEmail" type="email" placeholder="accounts@example.com" /></label><label>Billing address<textarea name="billingAddress" rows={2} /></label><button className="button-primary" type="submit"><Plus size={17} /> Add student</button></form></aside></div></>;
}
