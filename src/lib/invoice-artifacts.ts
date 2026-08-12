import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { Invoice } from "./types";
import { buildInvoiceWorkbook, invoiceArtifactBaseName } from "./invoice-workbook";

const execFileAsync = promisify(execFile);
const PDF_MIME = "application/pdf";

export interface InvoiceArtifacts {
  baseName: string;
  xlsx: Buffer;
  pdf: Buffer;
}

export async function convertInvoiceWorkbookToPdf(
  xlsx: Buffer,
  options?: { binary?: string; timeoutMs?: number },
): Promise<Buffer> {
  if (xlsx.length < 4 || xlsx.subarray(0, 2).toString("ascii") !== "PK") {
    throw new Error("Cannot convert an invalid XLSX buffer");
  }

  const workDir = await mkdtemp(join(tmpdir(), "teachnotes-invoice-"));
  const inputDir = join(workDir, "input");
  const outputDir = join(workDir, "output");
  const profileDir = join(workDir, "profile");
  const inputPath = join(inputDir, "invoice.xlsx");
  const outputPath = join(outputDir, "invoice.pdf");
  try {
    await Promise.all([mkdir(inputDir), mkdir(outputDir), mkdir(profileDir)]);
    await writeFile(inputPath, xlsx);
    const binary = options?.binary ?? process.env.LIBREOFFICE_BIN ?? "soffice";
    await execFileAsync(binary, [
      "--headless",
      "--nologo",
      "--nodefault",
      "--nolockcheck",
      "--norestore",
      `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
      "--convert-to",
      "pdf:calc_pdf_Export",
      "--outdir",
      outputDir,
      inputPath,
    ], {
      timeout: options?.timeoutMs ?? 30_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    const pdf = await readFile(outputPath);
    if (pdf.length < 8 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("LibreOffice did not produce a valid PDF");
    }
    return pdf;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function generateInvoiceArtifacts(invoice: Invoice): Promise<InvoiceArtifacts> {
  const xlsx = await buildInvoiceWorkbook(invoice);
  const pdf = await convertInvoiceWorkbookToPdf(xlsx);
  return { baseName: invoiceArtifactBaseName(invoice), xlsx, pdf };
}

export const INVOICE_ARTIFACT_MIME = {
  pdf: PDF_MIME,
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;
