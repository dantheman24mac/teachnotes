import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Invoice } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  getInvoice: vi.fn(),
  renderInvoicePdf: vi.fn(),
  requireApprovedUser: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  AuthorizationError: class AuthorizationError extends Error { constructor(public status: number) { super(); } },
  requireApprovedUser: mocks.requireApprovedUser,
}));
vi.mock("@/lib/data", () => ({ getInvoice: mocks.getInvoice }));
vi.mock("@/lib/invoice-pdf", () => ({ renderInvoicePdf: mocks.renderInvoicePdf }));
vi.mock("@/lib/supabase/server", () => ({
  isSupabaseConfigured: () => true,
  createClient: async () => ({ storage: { from: () => ({ download: mocks.download }) } }),
}));

import { GET as getPdf } from "@/app/api/invoices/[id]/pdf/route";
import { GET as getXlsx } from "@/app/api/invoices/[id]/xlsx/route";

function invoiceFixture(overrides?: Partial<Invoice>): Invoice {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    number: "INV-2026-0007",
    kind: "consolidated",
    status: "finalized",
    periodStart: "2026-07-01T00:00:00.000Z",
    periodEnd: "2026-07-31T23:59:59.999Z",
    recipientName: "Example Academy",
    recipientSnapshot: { name: "Example Academy", email: "", address: "" },
    tutorSnapshot: {
      tutorName: "Taylor Tutor", tutorEmail: "", tutorPhone: "", tutorAddress: "",
      defaultPayerName: "Example Academy", defaultPayerEmail: "", defaultPayerAddress: "",
      paymentTermsDays: 7, bankDetails: "", invoicePrefix: "INV", timezone: "Africa/Johannesburg", currency: "ZAR",
    },
    totalCents: 10000,
    issuedAt: "2026-08-01T00:00:00.000Z",
    dueAt: "2026-08-08T00:00:00.000Z",
    documentFormat: "spreadsheet_v1",
    pdfPath: "owner/invoice/INV-2026-0007.pdf",
    xlsxPath: "owner/invoice/INV-2026-0007.xlsx",
    lines: [],
    ...overrides,
  };
}

describe("invoice artifact download routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApprovedUser.mockResolvedValue({ user: { id: "owner" } });
  });

  it("serves the private spreadsheet with safe download headers", async () => {
    mocks.getInvoice.mockResolvedValue(invoiceFixture());
    mocks.download.mockResolvedValue({ data: new Blob(["xlsx-bytes"]), error: null });

    const response = await getXlsx(new Request("https://example.test"), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="INV-2026-0007.xlsx"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.download).toHaveBeenCalledWith("owner/invoice/INV-2026-0007.xlsx");
  });

  it("keeps legacy invoices PDF-only and reports missing new artifacts as retryable", async () => {
    mocks.getInvoice.mockResolvedValue(invoiceFixture({ documentFormat: "legacy_pdf", xlsxPath: null }));
    expect((await getXlsx(new Request("https://example.test"), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) })).status).toBe(404);

    mocks.getInvoice.mockResolvedValue(invoiceFixture({ pdfPath: null, xlsxPath: null }));
    expect((await getPdf(new Request("https://example.test"), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) })).status).toBe(409);
  });

  it("uses the immutable tutor snapshot for a legacy PDF fallback", async () => {
    const invoice = invoiceFixture({ documentFormat: "legacy_pdf", pdfPath: null, xlsxPath: null });
    mocks.getInvoice.mockResolvedValue(invoice);
    mocks.renderInvoicePdf.mockResolvedValue(Buffer.from("legacy-pdf"));

    const response = await getPdf(new Request("https://example.test"), { params: Promise.resolve({ id: invoice.id }) });

    expect(response.status).toBe(200);
    expect(mocks.renderInvoicePdf).toHaveBeenCalledWith(invoice, invoice.tutorSnapshot);
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="INV-2026-0007.pdf"');
  });
});
