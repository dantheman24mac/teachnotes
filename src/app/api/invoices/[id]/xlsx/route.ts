import { AuthorizationError, requireApprovedUser } from "@/lib/auth";
import { getInvoice } from "@/lib/data";
import { invoiceArtifactBaseName, SPREADSHEET_MIME } from "@/lib/invoice-workbook";
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
  if (invoice.documentFormat !== "spreadsheet_v1") {
    return new Response("Excel is not available for legacy invoices", { status: 404, headers: { "cache-control": "private, no-store" } });
  }
  if (!invoice.xlsxPath || !isSupabaseConfigured()) {
    return new Response("Invoice workbook is not ready", { status: 409, headers: { "cache-control": "private, no-store" } });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("invoices").download(invoice.xlsxPath);
  if (error || !data) return new Response("Invoice workbook is unavailable", { status: 503, headers: { "cache-control": "private, no-store" } });
  return new Response(data, {
    headers: {
      "content-type": SPREADSHEET_MIME,
      "content-disposition": `attachment; filename="${invoiceArtifactBaseName(invoice)}.xlsx"`,
      "cache-control": "private, no-store",
    },
  });
}
