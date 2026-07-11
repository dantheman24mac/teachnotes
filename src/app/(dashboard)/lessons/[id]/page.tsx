import { ArrowLeft, BookOpenText, Clock3, WalletCards } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { rescheduleLesson } from "@/app/actions";
import { LessonEditor } from "@/components/lesson-editor";
import { StatusChip } from "@/components/status-chip";
import { getLesson, getLessons } from "@/lib/data";
import { formatZar } from "@/lib/domain";

export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lesson = await getLesson(id);
  if (!lesson) notFound();
  const history = (await getLessons({ studentId: lesson.studentId, to: lesson.startsAt, limit: 21 })).filter((item) => item.id !== lesson.id && item.notes).reverse().slice(0, 20);
  const localValue = new Date(new Date(lesson.startsAt).getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 16);
  return <><Link href="/today" className="back-link"><ArrowLeft size={16} /> Today</Link><div className="lesson-hero"><div><p className="eyebrow">Lesson details</p><h1>{lesson.studentName}</h1><p>{new Intl.DateTimeFormat("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(lesson.startsAt))}</p></div><StatusChip status={lesson.status} /></div><div className="lesson-stat-row"><span><Clock3 /> <strong>{lesson.durationMinutes} min</strong></span><span><WalletCards /> <strong>{formatZar(lesson.rateCents)}</strong></span><span><BookOpenText /> <strong>{history.length} recent notes</strong></span></div><div className="two-column equal"><LessonEditor initialLesson={lesson} /><section className="content-stack"><div className="section-card"><div className="section-heading"><div><h2>Previous lesson notes</h2><p>Context without leaving this lesson.</p></div></div>{history.length ? <div className="note-timeline dense">{history.map((item) => <article key={item.id}><time>{new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short" }).format(new Date(item.startsAt))}</time><div><StatusChip status={item.status} /><p>{item.notes}</p></div></article>)}</div> : <div className="empty-state"><BookOpenText /><h3>No earlier notes yet</h3><p>This student’s lesson history will build here.</p></div>}<Link prefetch={false} href={`/students/${lesson.studentId}`} className="button-secondary full-width">View full student history</Link></div><details className="section-card schedule-details"><summary>Reschedule this lesson or series</summary><form action={rescheduleLesson} className="stack-form"><input type="hidden" name="lessonId" value={lesson.id} /><label>New date and time<input name="startsAtLocal" type="datetime-local" required defaultValue={localValue} /></label><label>Apply to<select name="scope"><option value="one">This lesson only</option><option value="following">This and following lessons</option><option value="all_future">All future lessons in the series</option></select></label><button className="button-secondary" type="submit">Update schedule</button><p className="form-help">Completed and invoiced lessons are never moved.</p></form></details></section></div></>;
}
