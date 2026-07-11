import { getBusinessSettings, getInvoice } from "@/lib/data";
import { renderInvoicePdf } from "@/lib/invoice-pdf";
import { createClient, getCurrentUser, isSupabaseConfigured } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (isSupabaseConfigured() && !(await getCurrentUser())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const invoice = await getInvoice(id);
  if (!invoice) return new Response("Not found", { status: 404 });
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const { data: row } = await supabase.from("invoices").select("pdf_path").eq("id", id).maybeSingle();
    if (row?.pdf_path) {
      const { data } = await supabase.storage.from("invoices").download(row.pdf_path);
      if (data) return new Response(data, { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${invoice.number ?? "invoice"}.pdf"`, "cache-control": "private, no-store" } });
    }
  }
  const buffer = await renderInvoicePdf(invoice, await getBusinessSettings());
  return new Response(new Uint8Array(buffer), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${invoice.number ?? "invoice"}.pdf"`, "cache-control": "private, no-store" } });
}
