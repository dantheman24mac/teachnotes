import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { convertInvoiceWorkbookToPdf } from "@/lib/invoice-artifacts";
import {
  buildInvoiceWorkbook,
  formatInvoiceLessonDate,
  groupInvoiceLines,
  invoiceArtifactBaseName,
} from "@/lib/invoice-workbook";
import type { BusinessSettings, Invoice, InvoiceLine } from "@/lib/types";

const tutorSnapshot: BusinessSettings = {
  tutorName: "Taylor Tutor",
  tutorEmail: "taylor@example.test",
  tutorPhone: "+27 82 000 0000",
  tutorAddress: "1 Example Road\nCape Town",
  defaultPayerName: "Example Academy",
  defaultPayerEmail: "accounts@example.test",
  defaultPayerAddress: "2 Example Avenue",
  paymentTermsDays: 7,
  bankDetails: "Example Bank\nAccount holder: Taylor Tutor\nAccount no.: 123456\nBranch no.: 470000",
  invoicePrefix: "INV",
  timezone: "Africa/Johannesburg",
  currency: "ZAR",
};

const lines: InvoiceLine[] = [
  { lessonId: "a", studentName: "Liam", lessonDate: "2026-07-27T10:00:00.000Z", durationMinutes: 60, status: "attended", amountCents: 26460 },
  { lessonId: "b", studentName: "Liam", lessonDate: "2026-07-20T10:00:00.000Z", durationMinutes: 60, status: "no_show", amountCents: 26460 },
  { lessonId: "c", studentName: "Liam", lessonDate: "2026-07-22T10:00:00.000Z", durationMinutes: 45, status: "attended", amountCents: 19845 },
  { lessonId: "d", studentName: "Beanca", lessonDate: "2026-07-23T10:00:00.000Z", durationMinutes: 30, status: "attended", amountCents: 13178 },
  { lessonId: "e", studentName: "Beanca", lessonDate: "2026-07-30T10:00:00.000Z", durationMinutes: 30, status: "attended", amountCents: 13178 },
];

function invoiceFixture(overrides?: Partial<Invoice>): Invoice {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    number: "INV-2026-0007",
    kind: "consolidated",
    status: "finalized",
    periodStart: "2026-06-30T22:00:00.000Z",
    periodEnd: "2026-07-31T21:59:59.999Z",
    recipientName: "Example Academy",
    recipientSnapshot: { name: "Example Academy", email: "accounts@example.test", address: "2 Example Avenue" },
    tutorSnapshot,
    totalCents: 99121,
    issuedAt: "2026-08-01T08:00:00.000Z",
    dueAt: "2026-08-08T08:00:00.000Z",
    documentFormat: "spreadsheet_v1",
    pdfPath: null,
    xlsxPath: null,
    lines,
    ...overrides,
  };
}

describe("invoice workbook", () => {
  it("groups by student, duration and rate while preserving chronological lesson dates", () => {
    const groups = groupInvoiceLines(lines, tutorSnapshot.timezone);
    expect(groups).toEqual([
      expect.objectContaining({ studentName: "Beanca", durationMinutes: 30, rateCents: 13178, lessonDates: ["23rd", "30th"], lessonCount: 2, totalCents: 26356 }),
      expect.objectContaining({ studentName: "Liam", durationMinutes: 45, rateCents: 19845, lessonDates: ["22nd"], lessonCount: 1, totalCents: 19845 }),
      expect.objectContaining({ studentName: "Liam", durationMinutes: 60, rateCents: 26460, lessonDates: ["20th", "27th"], lessonCount: 2, totalCents: 52920 }),
    ]);
    expect(formatInvoiceLessonDate("2026-07-21T22:30:00.000Z", tutorSnapshot.timezone)).toBe("22nd");
  });

  it("creates an auditable five-column A4 workbook with cached formula totals", async () => {
    const buffer = await buildInvoiceWorkbook(invoiceFixture());
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");

    const parsed = new ExcelJS.Workbook();
    await parsed.xlsx.load(buffer as unknown as Parameters<typeof parsed.xlsx.load>[0]);
    const sheet = parsed.getWorksheet("Invoice");
    expect(sheet).toBeDefined();
    expect(sheet!.getCell("A1").value).toBe("STUDENT LESSON INVOICE");
    expect(sheet!.getCell("A14").value).toBe("July 2026");
    expect(sheet!.getRow(16).values).toEqual([undefined, "Student", "Lesson dates", "No. of Lessons", "Rate", "Price Total"]);
    expect(sheet!.getCell("A17").value).toBe("Beanca\n30 mins");
    expect(sheet!.getCell("B19").value).toBe("20th, 27th");
    expect(sheet!.getCell("E19").value).toEqual({ formula: "C19*D19", result: 529.2 });
    expect(sheet!.getCell("E21").value).toEqual({ formula: "SUM(E17:E19)", result: 991.21 });
    expect(sheet!.getCell("E21").numFmt).toBe('"R" #,##0.00');
    expect(sheet!.pageSetup).toMatchObject({ paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "16:16" });
    expect(sheet!.pageSetup.printArea).toMatch(/^A1:E\d+$/);
    expect(sheet!.views[0]).toMatchObject({ state: "frozen", ySplit: 16, showGridLines: false });
  });

  it("rejects mismatched totals and sanitizes download names", async () => {
    await expect(buildInvoiceWorkbook(invoiceFixture({ totalCents: 1 }))).rejects.toThrow("does not match invoice total");
    expect(invoiceArtifactBaseName(invoiceFixture({ number: "INV 2026 / 7" }))).toBe("INV-2026-7");
    await expect(convertInvoiceWorkbookToPdf(Buffer.from("not xlsx"))).rejects.toThrow("invalid XLSX");
  });
});
