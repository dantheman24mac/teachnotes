import { ArrowLeft, Download, FileSpreadsheet, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { retryInvoiceArtifacts, voidInvoice } from "@/app/actions";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { getInvoice } from "@/lib/data";
import { formatZar } from "@/lib/domain";
import { formatInWorkspaceTime, getWorkspaceDateKey } from "@/lib/timezone";

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ artifact?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const invoice = await getInvoice(id);
  if (!invoice) notFound();
  const settings = invoice.tutorSnapshot;
  const month = getWorkspaceDateKey(invoice.periodStart, settings.timezone).slice(0, 7);
  const isSpreadsheet = invoice.documentFormat === "spreadsheet_v1";
  const artifactsReady = Boolean(invoice.xlsxPath && invoice.pdfPath);
  const canDownload = invoice.status !== "draft";

  return <>
    <Link href="/invoices" className="back-link"><ArrowLeft size={16} /> Invoices</Link>
    {query.artifact === "failed" && <div className="artifact-notice error" role="alert"><strong>The invoice was finalized safely, but its files could not be created.</strong><span>No lessons will be billed twice. Retry file generation below.</span></div>}
    {query.artifact === "ready" && <div className="artifact-notice success" role="status"><strong>Excel and PDF are ready.</strong><span>Both files were rebuilt from the immutable invoice snapshot.</span></div>}
    <div className="invoice-document section-card">
      <div className="document-head"><div><p className="eyebrow">{invoice.kind === "consolidated" ? "All-students invoice" : "Student invoice"}</p><h1>{invoice.number || "Draft invoice"}</h1><p>Issued to {invoice.recipientName}</p></div><div className={`document-seal ${invoice.status}`}><ShieldCheck />{invoice.status}</div></div>
      <div className="document-meta"><span><small>Period</small><strong>{formatInWorkspaceTime(invoice.periodStart, settings.timezone, { month: "long", year: "numeric" })}</strong></span><span><small>Issued</small><strong>{invoice.issuedAt ? formatInWorkspaceTime(invoice.issuedAt, settings.timezone, { day: "numeric", month: "numeric", year: "numeric" }) : "Not finalized"}</strong></span><span><small>Due</small><strong>{invoice.dueAt ? formatInWorkspaceTime(invoice.dueAt, settings.timezone, { day: "numeric", month: "numeric", year: "numeric" }) : "—"}</strong></span></div>
      <div className="invoice-lines-document">{invoice.lines.map((line) => <div key={line.lessonId}><span>{formatInWorkspaceTime(line.lessonDate, settings.timezone, { day: "numeric", month: "numeric", year: "numeric" })}</span><span>{line.studentName}</span><span>{line.durationMinutes} minutes</span><strong>{formatZar(line.amountCents)}</strong></div>)}</div>
      <div className="document-total"><span>{invoice.status === "draft" ? "Current preview" : "Total due"}</span><strong>{formatZar(invoice.totalCents)}</strong></div>
      {invoice.status === "void" && <div className="void-notice"><strong>Voided</strong><span>{invoice.voidReason}</span></div>}
    </div>
    <div className="document-actions">
      {invoice.status === "draft" && <Link className="button-primary" href={`/invoices/new?month=${month}&kind=${invoice.kind}${invoice.studentId ? `&student=${invoice.studentId}` : ""}`}>Reopen live preview</Link>}
      {canDownload && !isSpreadsheet && <a className="button-primary" href={`/api/invoices/${invoice.id}/pdf`}><Download size={17} /> Download PDF</a>}
      {canDownload && isSpreadsheet && artifactsReady && <><a className="button-primary" href={`/api/invoices/${invoice.id}/xlsx`}><FileSpreadsheet size={17} /> Download Excel</a><a className="button-secondary" href={`/api/invoices/${invoice.id}/pdf`}><Download size={17} /> Download PDF</a></>}
      {invoice.status === "finalized" && isSpreadsheet && !artifactsReady && <form action={retryInvoiceArtifacts}><input type="hidden" name="invoiceId" value={invoice.id} /><PendingSubmitButton className="button-primary" type="submit" pendingText="Creating Excel & PDF…"><RefreshCw size={17} /> Retry file generation</PendingSubmitButton></form>}
      {invoice.status === "finalized" && <details className="void-details"><summary><RotateCcw size={16} /> Void invoice</summary><form action={voidInvoice}><input type="hidden" name="invoiceId" value={invoice.id} /><label>Reason for voiding<textarea name="reason" required minLength={3} /></label><button className="danger-button" type="submit">Confirm void</button></form></details>}
    </div>
  </>;
}
