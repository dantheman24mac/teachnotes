import { ArrowLeft, CheckCircle2, FileText } from "lucide-react";
import Link from "next/link";
import { finalizeInvoice, saveDraftInvoice } from "@/app/actions";
import { InvoiceBuilder } from "@/components/invoice-builder";
import { StatusChip } from "@/components/status-chip";
import { getBusinessSettings, getInvoicePreview, getStudents } from "@/lib/data";
import { formatZar } from "@/lib/domain";
import { formatInWorkspaceTime, getWorkspaceDateKey } from "@/lib/timezone";

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ month?: string; kind?: string; student?: string }> }) {
  const params = await searchParams;
  const settings = await getBusinessSettings();
  const month = params.month ?? getWorkspaceDateKey(new Date(), settings.timezone).slice(0, 7);
  const kind = params.kind === "student" ? "student" : "consolidated";
  const students = await getStudents({ status: "all" });
  const selectedStudent = kind === "student" ? params.student : undefined;
  const preview = await getInvoicePreview(month, selectedStudent, settings);
  const grouped = Map.groupBy(preview.lessons, (lesson) => lesson.studentName);
  const summaryStudent = students.find((item) => item.id === selectedStudent);
  return <><Link href="/invoices" className="back-link"><ArrowLeft size={16} /> Invoices</Link><div className="page-heading"><div><p className="eyebrow">Review before finalizing</p><h1>New invoice</h1><p className="subtle">Only uninvoiced, billable lessons are included.</p></div></div><InvoiceBuilder students={students} month={month} /><div className="two-column wide-main"><section className="section-card invoice-preview"><div className="section-heading"><div><h2>Lesson breakdown</h2><p>{preview.lessons.length} eligible lessons</p></div><FileText /></div>{Array.from(grouped.entries()).map(([name, lessons]) => <div className="invoice-group" key={name}><div className="invoice-group-title"><strong>{name}</strong><span>{formatZar(lessons.reduce((sum, lesson) => sum + lesson.rateCents, 0))}</span></div>{lessons.map((lesson) => <div className="invoice-line" key={lesson.id}><span>{formatInWorkspaceTime(lesson.startsAt, settings.timezone, { day: "numeric", month: "short" })}</span><span>{lesson.durationMinutes} min</span><StatusChip status={lesson.status} /><strong>{formatZar(lesson.rateCents)}</strong></div>)}</div>)}{!preview.lessons.length && <div className="empty-state"><CheckCircle2 /><h3>Nothing to invoice</h3><p>Record attended or no-show lessons for this month, or choose another selection.</p></div>}</section><aside className="section-card invoice-summary sticky-card"><p className="eyebrow">Invoice total</p><strong className="grand-total">{formatZar(preview.totalCents)}</strong><div className="summary-line"><span>Type</span><strong>{kind === "consolidated" ? "All students" : summaryStudent ? `${summaryStudent.displayName}${summaryStudent.deletedAt ? " (Archived)" : ""}` : "Select a student"}</strong></div><div className="summary-line"><span>Tax</span><strong>Not applied</strong></div><form action={finalizeInvoice} className="invoice-actions"><input type="hidden" name="month" value={month} /><input type="hidden" name="kind" value={kind} /><input type="hidden" name="studentId" value={selectedStudent ?? ""} /><button disabled={!preview.lessons.length || (kind === "student" && !selectedStudent)} className="button-primary full-width" type="submit">Finalize & create PDF</button><button disabled={kind === "student" && !selectedStudent} className="button-secondary full-width" formAction={saveDraftInvoice} type="submit">Save draft</button></form><p className="form-help">Draft totals refresh when reopened. Finalized invoices are immutable.</p></aside></div></>;
}
