import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: true,
  createClient: vi.fn(),
  requireApprovedUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
  isSupabaseConfigured: () => mocks.configured,
}));
vi.mock("@/lib/auth", () => ({ requireApprovedUser: mocks.requireApprovedUser }));

import { getBusinessSettings, getInvoice } from "@/lib/data";
import { demoSettings } from "@/lib/demo-data";

function clientReturning(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return { from: vi.fn(() => query) };
}

describe("invoice data defaults", () => {
  beforeEach(() => {
    mocks.configured = true;
    mocks.createClient.mockReset();
    mocks.requireApprovedUser.mockReset();
    mocks.requireApprovedUser.mockResolvedValue({
      user: { id: "11111111-1111-4111-8111-111111111111", email: "real-user@example.test" },
    });
  });

  it("uses blank invoice details when a real account has no settings row", async () => {
    mocks.createClient.mockResolvedValue(clientReturning({ data: null, error: null }));

    await expect(getBusinessSettings()).resolves.toEqual({
      tutorName: "",
      tutorEmail: "",
      tutorPhone: "",
      tutorAddress: "",
      defaultPayerName: "",
      defaultPayerEmail: "",
      defaultPayerAddress: "",
      paymentTermsDays: 7,
      bankDetails: "",
      invoicePrefix: "INV",
      timezone: "Africa/Johannesburg",
      currency: "ZAR",
    });
  });

  it("reports settings query errors instead of treating them as a missing row", async () => {
    const queryError = new Error("settings query failed");
    mocks.createClient.mockResolvedValue(clientReturning({ data: null, error: queryError }));

    await expect(getBusinessSettings()).rejects.toBe(queryError);
  });

  it("maps an empty stored tutor snapshot to blank real details", async () => {
    mocks.createClient.mockResolvedValue(clientReturning({
      data: {
        id: "61000000-0000-4000-8000-000000000001",
        number: "INV-2026-0001",
        kind: "consolidated",
        status: "finalized",
        period_start: "2026-08-31T22:00:00.000Z",
        period_end: "2026-09-30T21:59:59.999Z",
        tutor_snapshot: {},
        recipient_snapshot: {},
        total_cents: 0,
        document_format: "spreadsheet_v1",
        invoice_lines: [],
      },
      error: null,
    }));

    const invoice = await getInvoice("61000000-0000-4000-8000-000000000001");

    expect(invoice?.tutorSnapshot.tutorName).toBe("");
    expect(invoice?.tutorSnapshot.tutorEmail).toBe("");
    expect(invoice?.tutorSnapshot.bankDetails).toBe("");
    expect(invoice?.tutorSnapshot.invoicePrefix).toBe("INV");
    expect(invoice?.recipientSnapshot).toEqual({ name: "", email: "", address: "" });
  });

  it("keeps the populated settings in demo mode", async () => {
    mocks.configured = false;

    await expect(getBusinessSettings()).resolves.toBe(demoSettings);
    expect(mocks.requireApprovedUser).not.toHaveBeenCalled();
  });
});
