import { AuthorizationError, requireApprovedUser } from "@/lib/auth";
import { getInvoice } from "@/lib/data";
import { invoiceArtifactBaseName } from "@/lib/invoice-workbook";
import { renderInvoicePdf } from "@/lib/invoice-pdf";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (isSupabaseConfigured()) {
    try {
      await requireApprovedUser();
    } catch (error) {
      const status = error instanceof AuthorizationError ? error.status : 500;
      return Response.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
    }
  }
  const { id } = await params;
  const invoice = await getInvoice(id);
  if (!invoice) return new Response("Not found", { status: 404 });
  const filename = `${invoiceArtifactBaseName(invoice)}.pdf`;
  if (isSupabaseConfigured()) {
    if (invoice.documentFormat === "spreadsheet_v1" && !invoice.pdfPath) {
      return new Response("Invoice PDF is not ready", { status: 409, headers: { "cache-control": "private, no-store" } });
    }
    if (invoice.pdfPath) {
      const supabase = await createClient();
      const { data, error } = await supabase.storage.from("invoices").download(invoice.pdfPath);
      if (data) return new Response(data, { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "private, no-store" } });
      if (error && invoice.documentFormat === "spreadsheet_v1") {
        return new Response("Invoice PDF is unavailable", { status: 503, headers: { "cache-control": "private, no-store" } });
      }
    }
  }
  if (invoice.documentFormat !== "legacy_pdf") {
    return new Response("Invoice PDF is not ready", { status: 409, headers: { "cache-control": "private, no-store" } });
  }
  const buffer = await renderInvoicePdf(invoice, invoice.tutorSnapshot);
  return new Response(new Uint8Array(buffer), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "private, no-store" } });
}
