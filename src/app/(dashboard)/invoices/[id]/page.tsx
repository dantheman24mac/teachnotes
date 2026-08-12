import { ArrowLeft, Download, RotateCcw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { voidInvoice } from "@/app/actions";
import { getInvoice } from "@/lib/data";
import { formatZar } from "@/lib/domain";
import { formatInWorkspaceTime, getWorkspaceDateKey } from "@/lib/timezone";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await getInvoice(id);
  if (!invoice) notFound();
  const settings = invoice.tutorSnapshot;
  if (!settings) notFound();
  const month = getWorkspaceDateKey(invoice.periodStart, settings.timezone).slice(0, 7);
  return <><Link href="/invoices" className="back-link"><ArrowLeft size={16} /> Invoices</Link><div className="invoice-document section-card"><div className="document-head"><div><p className="eyebrow">{invoice.kind === "consolidated" ? "All-students invoice" : "Student invoice"}</p><h1>{invoice.number || "Draft invoice"}</h1><p>Issued to {invoice.recipientName}</p></div><div className={`document-seal ${invoice.status}`}><ShieldCheck />{invoice.status}</div></div><div className="document-meta"><span><small>Period</small><strong>{formatInWorkspaceTime(invoice.periodStart, settings.timezone, { month: "long", year: "numeric" })}</strong></span><span><small>Issued</small><strong>{invoice.issuedAt ? formatInWorkspaceTime(invoice.issuedAt, settings.timezone, { day: "numeric", month: "numeric", year: "numeric" }) : "Not finalized"}</strong></span><span><small>Due</small><strong>{invoice.dueAt ? formatInWorkspaceTime(invoice.dueAt, settings.timezone, { day: "numeric", month: "numeric", year: "numeric" }) : "—"}</strong></span></div><div className="invoice-lines-document">{invoice.lines.map((line) => <div key={line.lessonId}><span>{formatInWorkspaceTime(line.lessonDate, settings.timezone, { day: "numeric", month: "numeric", year: "numeric" })}</span><span>{line.studentName}</span><span>{line.durationMinutes} minutes</span><strong>{formatZar(line.amountCents)}</strong></div>)}</div><div className="document-total"><span>{invoice.status === "draft" ? "Current preview" : "Total due"}</span><strong>{formatZar(invoice.totalCents)}</strong></div>{invoice.status === "void" && <div className="void-notice"><strong>Voided</strong><span>{invoice.voidReason}</span></div>}</div><div className="document-actions">{invoice.status === "draft" ? <Link className="button-primary" href={`/invoices/new?month=${month}&kind=${invoice.kind}${invoice.studentId ? `&student=${invoice.studentId}` : ""}`}>Reopen live preview</Link> : <a className="button-primary" href={`/api/invoices/${invoice.id}/pdf`}><Download size={17} /> Download PDF</a>}{invoice.status === "finalized" && <details className="void-details"><summary><RotateCcw size={16} /> Void invoice</summary><form action={voidInvoice}><input type="hidden" name="invoiceId" value={invoice.id} /><label>Reason for voiding<textarea name="reason" required minLength={3} /></label><button className="danger-button" type="submit">Confirm void</button></form></details>}</div></>;
}
