import { Archive, ArrowLeft, BookOpenText, CalendarDays, Mail, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateStudentDefaults } from "@/app/actions";
import { ArchiveStudentControl, RestoreStudentControl } from "@/components/student-archive-controls";
import { getBusinessSettings, getLessons, getStudent } from "@/lib/data";
import { formatZar } from "@/lib/domain";
import { formatInWorkspaceTime } from "@/lib/timezone";
import { StatusChip } from "@/components/status-chip";

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [student, lessons, settings] = await Promise.all([getStudent(id, { includeArchived: true }), getLessons({ studentId: id, limit: 50 }), getBusinessSettings()]);
  if (!student) notFound();
  const archived = Boolean(student.deletedAt);
  const future = lessons.filter((lesson) => new Date(lesson.startsAt) >= new Date()).slice(0, 5);
  const history = lessons.filter((lesson) => lesson.notes && new Date(lesson.startsAt) < new Date()).reverse().slice(0, 20);
  return <>
    <Link href={archived ? "/students?view=archived" : "/students"} className="back-link"><ArrowLeft size={16} /> Students</Link>
    <div className="profile-hero">
      <span className="avatar large">{student.displayName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
      <div><p className="eyebrow">Student profile</p><h1>{student.displayName}</h1><p>{student.guardianName || "No billing contact"}{student.billingEmail && <> · {student.billingEmail}</>}</p></div>
      {archived && <span className="archive-badge profile-archive-badge"><Archive size={13} /> Archived {formatInWorkspaceTime(student.deletedAt!, settings.timezone, { day: "numeric", month: "short", year: "numeric" })}</span>}
    </div>
    <div className="two-column">
      <div className="content-stack">
        <section className="section-card"><div className="section-heading"><div><h2><CalendarDays /> Upcoming lessons</h2><p>{archived ? "Only preserved records are shown." : "The next scheduled sessions."}</p></div></div>{future.length ? <div className="compact-list">{future.map((lesson) => <Link prefetch={false} href={`/lessons/${lesson.id}`} key={lesson.id}><div><strong>{formatInWorkspaceTime(lesson.startsAt, settings.timezone, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</strong><small>{lesson.durationMinutes} min · {formatZar(lesson.rateCents)}</small></div><StatusChip status={lesson.status} /></Link>)}</div> : <p className="empty-copy">No future lessons scheduled.</p>}</section>
        <section className="section-card"><div className="section-heading"><div><h2><BookOpenText /> Previous lesson notes</h2><p>Most recent first. Older notes load from the archive when connected.</p></div></div>{history.length ? <div className="note-timeline">{history.map((lesson) => <article key={lesson.id}><time>{formatInWorkspaceTime(lesson.startsAt, settings.timezone, { day: "numeric", month: "short", year: "numeric" })}</time><div><StatusChip status={lesson.status} /><p>{lesson.notes}</p></div></article>)}</div> : <p className="empty-copy">No previous lesson notes.</p>}</section>
      </div>
      <aside className="section-card sticky-card">
        <div className="card-icon">{archived ? <Archive /> : <UserRound />}</div>
        <h2>{archived ? "Archived student" : "Lesson defaults"}</h2>
        {archived
          ? <RestoreStudentControl studentId={student.id} />
          : <><form className="stack-form" action={updateStudentDefaults}><input type="hidden" name="studentId" value={student.id} /><label>Default duration<input name="duration" type="number" min="15" step="5" defaultValue={student.defaultDurationMinutes} /></label><label>Lesson amount (R)<input name="rateRand" type="number" min="0" step="0.01" defaultValue={(student.defaultRateCents / 100).toFixed(2)} /></label><label className="check-row"><input name="applyFuture" type="checkbox" />Apply to future scheduled lessons</label><button className="button-primary" type="submit">Save defaults</button></form><ArchiveStudentControl studentId={student.id} /></>}
        <div className="contact-block"><span><Mail size={16} />{student.billingEmail || "No billing email"}</span></div>
      </aside>
    </div>
  </>;
}
