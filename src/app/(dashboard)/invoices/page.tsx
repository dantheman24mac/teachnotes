import { ArrowUpRight, FileCheck2, Plus, ReceiptText } from "lucide-react";
import Link from "next/link";
import { getInvoices } from "@/lib/data";
import { formatZar } from "@/lib/domain";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage() {
  const invoices = await getInvoices();
  const currentYear = new Date().getFullYear();
  const total = invoices.filter((invoice) => invoice.status === "finalized" && new Date(invoice.periodStart).getFullYear() === currentYear).reduce((sum, invoice) => sum + invoice.totalCents, 0);
  return <><div className="page-heading"><div><p className="eyebrow">Get paid accurately</p><h1>Invoices</h1><p className="subtle">Finalize immutable monthly records from billable lessons.</p></div><Link href="/invoices/new" className="button-primary"><Plus size={17} /> New invoice</Link></div><section className="metric-grid two"><article className="metric-card metric-featured"><span>Finalized this year</span><strong>{formatZar(total)}</strong><small>{invoices.filter((invoice) => invoice.status === "finalized").length} invoices</small></article><article className="metric-card"><span>Primary workflow</span><strong>All students</strong><small>with per-student support</small></article></section><section className="section-card"><div className="section-heading"><div><h2>Invoice history</h2><p>Finalized documents never change.</p></div><ReceiptText /></div>{invoices.length ? <div className="invoice-table"><div className="table-head"><span>Invoice</span><span>Period</span><span>Recipient</span><span>Status</span><span>Total</span><span /></div>{invoices.map((invoice) => <Link prefetch={false} href={`/invoices/${invoice.id}`} className="table-row" key={invoice.id}><span><FileCheck2 size={17} /><strong>{invoice.number || "Draft"}</strong></span><span>{new Intl.DateTimeFormat("en-ZA", { month: "short", year: "numeric" }).format(new Date(invoice.periodStart))}</span><span>{invoice.recipientName}</span><span><em className={`invoice-status ${invoice.status}`}>{invoice.status}</em></span><span><strong>{formatZar(invoice.totalCents)}</strong></span><span><ArrowUpRight /></span></Link>)}</div> : <div className="empty-state"><ReceiptText /><h3>No invoices yet</h3><p>Create your first invoice from completed, billable lessons.</p></div>}</section></>;
}
