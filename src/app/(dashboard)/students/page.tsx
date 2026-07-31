import { Archive, Plus, UserRound } from "lucide-react";
import Link from "next/link";
import { createStudent } from "@/app/actions";
import { StudentList } from "@/components/student-list";
import { getStudents } from "@/lib/data";

export const metadata = { title: "Students" };

export default async function StudentsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const [{ view }, activeStudents, archivedStudents] = await Promise.all([
    searchParams,
    getStudents(),
    getStudents({ status: "archived" }),
  ]);
  const archived = view === "archived";
  const students = archived ? archivedStudents : activeStudents;
  return <>
    <div className="page-heading">
      <div><p className="eyebrow">Your roster</p><h1>Students</h1><p className="subtle">Rates, billing contacts and lesson history in one place.</p></div>
      <nav className="filter-tabs student-tabs" aria-label="Student status">
        <Link className={!archived ? "active" : ""} aria-current={!archived ? "page" : undefined} href="/students">Active <span>{activeStudents.length}</span></Link>
        <Link className={archived ? "active" : ""} aria-current={archived ? "page" : undefined} href="/students?view=archived">Archived <span>{archivedStudents.length}</span></Link>
      </nav>
    </div>
    <div className="two-column wide-main">
      <StudentList students={students} archived={archived} />
      {archived
        ? <aside className="section-card sticky-card"><div className="card-icon"><Archive /></div><h2>Archived students</h2><p className="subtle">Open a student to review preserved lesson history or restore them. Old recurring series stay archived.</p></aside>
        : <aside className="section-card sticky-card"><div className="card-icon"><UserRound /></div><h2>Add a student</h2><form className="stack-form" action={createStudent}><label>Student name<input name="displayName" required placeholder="Full name" /></label><div className="form-split"><label>Duration<input name="defaultDurationMinutes" type="number" min="15" step="5" defaultValue="60" required /></label><label>Lesson amount (R)<input name="defaultRateRand" type="number" min="0" step="0.01" defaultValue="450" required /></label></div><label>Billing contact<input name="guardianName" placeholder="Parent, guardian or client" /></label><label>Billing email<input name="billingEmail" type="email" placeholder="accounts@example.com" /></label><label>Billing address<textarea name="billingAddress" rows={2} /></label><button className="button-primary" type="submit"><Plus size={17} /> Add student</button></form></aside>}
    </div>
  </>;
}
