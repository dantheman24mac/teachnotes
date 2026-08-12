import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateInvoiceArtifacts } from "@/lib/invoice-artifacts";
import type { BusinessSettings, Invoice, InvoiceLine } from "@/lib/types";

const conversionIt = process.env.RUN_INVOICE_CONVERSION_TEST === "true" ? it : it.skip;

const tutorSnapshot: BusinessSettings = {
  tutorName: "Taylor Tutor",
  tutorEmail: "taylor@example.test",
  tutorPhone: "+27 82 000 0000",
  tutorAddress: "1 Example Road, Cape Town",
  defaultPayerName: "Example Academy",
  defaultPayerEmail: "accounts@example.test",
  defaultPayerAddress: "2 Example Avenue, Cape Town",
  paymentTermsDays: 7,
  bankDetails: "Example Bank\nAccount holder: Taylor Tutor\nAccount no.: 1234567890\nBranch no.: 470000",
  invoicePrefix: "INV",
  timezone: "Africa/Johannesburg",
  currency: "ZAR",
};

function makeInvoice(id: string, number: string, lines: InvoiceLine[], kind: Invoice["kind"]): Invoice {
  return {
    id,
    number,
    kind,
    status: "finalized",
    periodStart: "2026-06-30T22:00:00.000Z",
    periodEnd: "2026-07-31T21:59:59.999Z",
    recipientName: kind === "consolidated" ? "Example Academy" : "Jordan Parent",
    recipientSnapshot: {
      name: kind === "consolidated" ? "Example Academy" : "Jordan Parent",
      email: "accounts@example.test",
      address: "2 Example Avenue, Cape Town",
    },
    tutorSnapshot,
    totalCents: lines.reduce((sum, line) => sum + line.amountCents, 0),
    issuedAt: "2026-08-01T08:00:00.000Z",
    dueAt: "2026-08-08T08:00:00.000Z",
    documentFormat: "spreadsheet_v1",
    pdfPath: null,
    xlsxPath: null,
    lines,
  };
}

async function saveQaArtifacts(invoice: Invoice) {
  const artifacts = await generateInvoiceArtifacts(invoice);
  expect(artifacts.xlsx.subarray(0, 2).toString("ascii")).toBe("PK");
  expect(artifacts.pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  const outputDir = process.env.INVOICE_QA_OUTPUT_DIR;
  if (outputDir) {
    await mkdir(outputDir, { recursive: true });
    await Promise.all([
      writeFile(join(outputDir, `${artifacts.baseName}.xlsx`), artifacts.xlsx),
      writeFile(join(outputDir, `${artifacts.baseName}.pdf`), artifacts.pdf),
    ]);
  }
}

describe("LibreOffice invoice conversion", () => {
  conversionIt("converts short and multipage workbooks from the exact XLSX bytes", async () => {
    const shortLines: InvoiceLine[] = [
      { lessonId: "short-1", studentName: "Jordan", lessonDate: "2026-07-07T13:00:00.000Z", durationMinutes: 45, status: "attended", amountCents: 19845 },
      { lessonId: "short-2", studentName: "Jordan", lessonDate: "2026-07-14T13:00:00.000Z", durationMinutes: 45, status: "no_show", amountCents: 19845 },
    ];
    const longLines = Array.from({ length: 36 }, (_, index): InvoiceLine => ({
      lessonId: `long-${index + 1}`,
      studentName: `Student ${String(index + 1).padStart(2, "0")}`,
      lessonDate: `2026-07-${String((index % 28) + 1).padStart(2, "0")}T13:00:00.000Z`,
      durationMinutes: [30, 45, 60][index % 3],
      status: index % 5 === 0 ? "no_show" : "attended",
      amountCents: [13178, 19845, 26460][index % 3],
    }));

    await saveQaArtifacts(makeInvoice("22222222-2222-4222-8222-222222222222", "INV-2026-0008", shortLines, "student"));
    await saveQaArtifacts(makeInvoice("33333333-3333-4333-8333-333333333333", "INV-2026-0009", longLines, "consolidated"));
  }, 60_000);
});
