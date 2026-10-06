import { Archive, ArrowLeft, BookOpenText, CalendarDays, Mail, Pencil, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArchiveStudentControl, RestoreStudentControl } from "@/components/student-archive-controls";
import { StudentDefaultsForm } from "@/components/student-defaults-form";
import { StudentLessonHistory } from "@/components/student-lesson-history";
import { getBusinessSettings, getLessonHistoryPage, getStudent, getUpcomingLessons } from "@/lib/data";
import { formatZar } from "@/lib/domain";
import { formatInWorkspaceTime } from "@/lib/timezone";
import { StatusChip } from "@/components/status-chip";

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const now = new Date().toISOString();
  const [student, future, historyPage, settings] = await Promise.all([
    getStudent(id, { includeArchived: true }),
    getUpcomingLessons(id, now),
    getLessonHistoryPage({ studentId: id, before: now }),
    getBusinessSettings(),
  ]);
  if (!student) notFound();
  const archived = Boolean(student.deletedAt);
  return <>
    <Link href={archived ? "/students?view=archived" : "/students"} className="back-link"><ArrowLeft size={16} /> Students</Link>
    <div className="profile-hero">
      <span className="avatar large">{student.displayName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
      <div><p className="eyebrow">Student profile</p><h1>{student.displayName}</h1><p>{student.guardianName || "No billing contact"}{student.billingEmail && <> · {student.billingEmail}</>}</p></div>
      {archived
        ? <span className="archive-badge profile-archive-badge"><Archive size={13} /> Archived {formatInWorkspaceTime(student.deletedAt!, settings.timezone, { day: "numeric", month: "short", year: "numeric" })}</span>
        : <Link className="button-secondary profile-action" href={`/students/${student.id}/edit`}><Pencil size={16} /> Edit student</Link>}
    </div>
    <div className="two-column">
      <div className="content-stack">
        <section className="section-card"><div className="section-heading"><div><h2><CalendarDays /> Upcoming lessons</h2><p>{archived ? "Only preserved records are shown." : "The next scheduled sessions."}</p></div></div>{future.length ? <div className="compact-list">{future.map((lesson) => <Link prefetch={false} href={`/lessons/${lesson.id}`} key={lesson.id}><div><strong>{formatInWorkspaceTime(lesson.startsAt, settings.timezone, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</strong><small>{lesson.durationMinutes} min · {formatZar(lesson.rateCents)}</small></div><StatusChip status={lesson.status} /></Link>)}</div> : <p className="empty-copy">No future lessons scheduled.</p>}</section>
        <section className="section-card"><div className="section-heading"><div><h2><BookOpenText /> Previous lesson notes</h2><p>Most recent first.</p></div></div><StudentLessonHistory initialLessons={historyPage.lessons} initialNextCursor={historyPage.nextCursor} studentId={id} timezone={settings.timezone} /></section>
      </div>
      <aside className="section-card sticky-card">
        <div className="card-icon">{archived ? <Archive /> : <UserRound />}</div>
        <h2>{archived ? "Archived student" : "Lesson defaults"}</h2>
        {archived
          ? <RestoreStudentControl studentId={student.id} />
          : <><StudentDefaultsForm studentId={student.id} durationMinutes={student.defaultDurationMinutes} rateCents={student.defaultRateCents} /><ArchiveStudentControl studentId={student.id} /></>}
        <div className="contact-block"><span><Mail size={16} />{student.billingEmail || "No billing email"}</span></div>
      </aside>
    </div>
  </>;
}
