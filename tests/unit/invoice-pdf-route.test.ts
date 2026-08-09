import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BusinessSettings, Invoice } from "@/lib/types";

const snapshotSettings: BusinessSettings = {
  tutorName: "Immutable Snapshot Tutor",
  tutorEmail: "snapshot@example.test",
  tutorPhone: "",
  tutorAddress: "Snapshot address",
  defaultPayerName: "Snapshot payer",
  defaultPayerEmail: "payer@example.test",
  defaultPayerAddress: "Payer address",
  paymentTermsDays: 7,
  bankDetails: "Snapshot bank details",
  invoicePrefix: "SNAP",
  timezone: "Africa/Johannesburg",
  currency: "ZAR",
};

const liveSettings: BusinessSettings = {
  ...snapshotSettings,
  tutorName: "Changed Live Tutor",
  timezone: "America/New_York",
};

const invoice: Invoice = {
  id: "c1111111-1111-4111-8111-111111111111",
  number: "SNAP-2026-0001",
  kind: "student",
  status: "finalized",
  periodStart: "2026-07-31T22:00:00.000Z",
  periodEnd: "2026-08-31T21:59:59.999Z",
  recipientName: "Snapshot recipient",
  totalCents: 22222,
  tutorSnapshot: snapshotSettings,
  lines: [],
};

const renderInvoicePdf = vi.fn(async () => Buffer.from("fallback-pdf"));
const getBusinessSettings = vi.fn(async () => liveSettings);

vi.mock("@/lib/auth", () => ({
  AuthorizationError: class AuthorizationError extends Error { status = 403; },
  requireApprovedUser: vi.fn(async () => ({ user: { id: "user-id" } })),
}));
vi.mock("@/lib/data", () => ({
  getBusinessSettings,
  getInvoice: vi.fn(async () => invoice),
}));
vi.mock("@/lib/invoice-pdf", () => ({ renderInvoicePdf }));
vi.mock("@/lib/supabase/server", () => ({
  isSupabaseConfigured: vi.fn(() => true),
  createClient: vi.fn(async () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: { pdf_path: "missing.pdf" } })) })),
      })),
    })),
    storage: {
      from: vi.fn(() => ({ download: vi.fn(async () => ({ data: null, error: new Error("missing") })) })),
    },
  })),
}));

describe("invoice PDF fallback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders with the immutable invoice snapshot when the stored PDF is unavailable", async () => {
    const { GET } = await import("@/app/api/invoices/[id]/pdf/route");
    const response = await GET(new Request("http://localhost/api/invoices/c1111111-1111-4111-8111-111111111111/pdf"), {
      params: Promise.resolve({ id: invoice.id }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(renderInvoicePdf).toHaveBeenCalledOnce();
    expect(renderInvoicePdf).toHaveBeenCalledWith(invoice, snapshotSettings);
    expect(getBusinessSettings).not.toHaveBeenCalled();
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("fallback-pdf");
  });
});
