import { CalendarPlus, Clock3, Repeat2 } from "lucide-react";
import Link from "next/link";
import { createLessonSeries } from "@/app/timezone-actions";
import { ensureSeriesHorizon, getBusinessSettings, getLessons, getStudents } from "@/lib/data";
import { formatZar } from "@/lib/domain";
import { formatInWorkspaceTime, getWorkspaceDateKey } from "@/lib/timezone";
import { StatusChip } from "@/components/status-chip";

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const metadata = { title: "Calendar" };

export default async function CalendarPage() {
  await ensureSeriesHorizon();
  const from = new Date(); from.setDate(from.getDate() - 7);
  const to = new Date(); to.setDate(to.getDate() + 35);
  const [lessons, students, settings] = await Promise.all([getLessons({ from: from.toISOString(), to: to.toISOString() }), getStudents(), getBusinessSettings()]);
  const grouped = Map.groupBy(lessons, (lesson) => getWorkspaceDateKey(lesson.startsAt, settings.timezone));
  return <><div className="page-heading"><div><p className="eyebrow">Plan ahead</p><h1>Calendar</h1><p className="subtle">Recurring lessons, exceptions and upcoming teaching time.</p></div></div><div className="two-column wide-main"><section className="section-card"><div className="section-heading"><div><h2>Coming up</h2><p>Five-week agenda</p></div><span className="date-chip">{lessons.length} lessons</span></div><div className="calendar-agenda">{Array.from(grouped.entries()).map(([day, dayLessons]) => <div className="calendar-day" key={day}><div className="calendar-date"><strong>{formatInWorkspaceTime(dayLessons[0].startsAt, settings.timezone, { day: "numeric" })}</strong><span>{formatInWorkspaceTime(dayLessons[0].startsAt, settings.timezone, { weekday: "short", month: "short" })}</span></div><div className="calendar-events">{dayLessons.map((lesson) => <Link prefetch={false} className="calendar-event" key={lesson.id} href={`/lessons/${lesson.id}`}><span className="event-time">{formatInWorkspaceTime(lesson.startsAt, settings.timezone, { hour: "2-digit", minute: "2-digit" })}</span><div><strong>{lesson.studentName}</strong><small>{lesson.durationMinutes} min · {formatZar(lesson.rateCents)}</small></div><StatusChip status={lesson.status} /></Link>)}</div></div>)}</div></section><aside className="section-card sticky-card"><div className="card-icon"><Repeat2 /></div><h2>New recurring series</h2><p className="subtle">Create weekly or fortnightly lessons up to 12 months ahead.</p><form action={createLessonSeries} className="stack-form"><label>Student<select name="studentId" required defaultValue=""><option value="" disabled>Choose a student</option>{students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}</select></label><label>First lesson<input name="startsAtLocal" type="datetime-local" required /></label><label>Repeats<select name="frequency"><option value="weekly">Every week</option><option value="fortnightly">Every two weeks</option></select></label><fieldset><legend>Teaching days</legend><div className="weekday-grid">{weekdays.map((day, index) => <label key={day}><input type="checkbox" name="weekdays" value={index} />{day.slice(0, 1)}</label>)}</div></fieldset><label>End date <span className="optional">optional</span><input name="until" type="date" /></label><label>Excluded dates <span className="optional">optional</span><input name="exclusions" placeholder="2026-09-24, 2026-12-16" /></label><button className="button-primary" type="submit"><CalendarPlus size={17} /> Create series</button><p className="form-help"><Clock3 size={14} /> Open-ended series extend as you use the app.</p></form></aside></div></>;
}
