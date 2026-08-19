import { ArrowLeft, CircleDollarSign, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StudentProfileForm } from "@/components/student-profile-form";
import { getStudent } from "@/lib/data";

export const metadata = { title: "Edit student" };

export default async function EditStudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const student = await getStudent(id);
  if (!student) notFound();
  return <>
    <Link href={`/students/${student.id}`} className="back-link"><ArrowLeft size={16} /> Student profile</Link>
    <div className="page-heading">
      <div><p className="eyebrow">Student profile</p><h1>Edit {student.displayName}</h1><p className="subtle">Update the details used across your roster and future invoices.</p></div>
    </div>
    <div className="two-column wide-main">
      <StudentProfileForm student={student} />
      <aside className="section-card sticky-card">
        <div className="card-icon"><UserRound /></div>
        <h2>Student details</h2>
        <p className="subtle">Name and billing changes appear throughout the live workspace.</p>
        <div className="edit-student-note"><CircleDollarSign size={17} /><p>Lesson duration and amount stay unchanged. Manage those separately under Lesson defaults on the student profile.</p></div>
      </aside>
    </div>
  </>;
}
