import ExcelJS from "exceljs";
import { formatInTimeZone } from "date-fns-tz";
import type { Invoice, InvoiceLine } from "./types";

export const SPREADSHEET_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface InvoiceWorkbookGroup {
  studentName: string;
  durationMinutes: number;
  rateCents: number;
  lessonDates: string[];
  lessonCount: number;
  totalCents: number;
}

const DARK_GRAY = "5B6573";
const HEADER_GRAY = "D9D9D9";
const STUDENT_GRAY = "E7E7E7";
const LIGHT_BLUE = "EAF2F8";
const INPUT_YELLOW = "FFF4CC";
const BORDER_GRAY = "8A8A8A";
const WHITE = "FFFFFF";
const FONT = "Times New Roman";
const CURRENCY_FORMAT = '"R" #,##0.00';

function cleanCellText(value: unknown) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim();
}

function ordinal(day: number) {
  const remainder = day % 100;
  if (remainder >= 11 && remainder <= 13) return `${day}th`;
  if (day % 10 === 1) return `${day}st`;
  if (day % 10 === 2) return `${day}nd`;
  if (day % 10 === 3) return `${day}rd`;
  return `${day}th`;
}

export function formatInvoiceLessonDate(value: string, timezone: string) {
  return ordinal(Number(formatInTimeZone(value, timezone, "d")));
}

export function formatDuration(minutes: number) {
  if (minutes === 60) return "1 hour";
  if (minutes > 60 && minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} mins`;
}

export function groupInvoiceLines(lines: InvoiceLine[], timezone: string): InvoiceWorkbookGroup[] {
  const groups = new Map<string, InvoiceLine[]>();
  for (const line of lines) {
    const key = JSON.stringify([line.studentName, line.durationMinutes, line.amountCents]);
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }

  return Array.from(groups.values())
    .map((group) => {
      const sorted = [...group].sort((left, right) => left.lessonDate.localeCompare(right.lessonDate));
      const first = sorted[0];
      return {
        studentName: first.studentName,
        durationMinutes: first.durationMinutes,
        rateCents: first.amountCents,
        lessonDates: sorted.map((line) => formatInvoiceLessonDate(line.lessonDate, timezone)),
        lessonCount: sorted.length,
        totalCents: sorted.reduce((sum, line) => sum + line.amountCents, 0),
      };
    })
    .sort((left, right) =>
      left.studentName.localeCompare(right.studentName, "en-ZA", { sensitivity: "base", numeric: true })
      || left.durationMinutes - right.durationMinutes
      || left.rateCents - right.rateCents,
    );
}

export function invoiceArtifactBaseName(invoice: Pick<Invoice, "id" | "number">) {
  const source = cleanCellText(invoice.number || `invoice-${invoice.id}`);
  const safe = source.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || `invoice-${invoice.id}`;
}

function setThinBorders(range: ExcelJS.Cell[][]) {
  for (const row of range) {
    for (const cell of row) {
      cell.border = {
        top: { style: "thin", color: { argb: BORDER_GRAY } },
        left: { style: "thin", color: { argb: BORDER_GRAY } },
        bottom: { style: "thin", color: { argb: BORDER_GRAY } },
        right: { style: "thin", color: { argb: BORDER_GRAY } },
      };
    }
  }
}

export async function buildInvoiceWorkbook(invoice: Invoice): Promise<Buffer> {
  const timezone = invoice.tutorSnapshot.timezone || "Africa/Johannesburg";
  const groups = groupInvoiceLines(invoice.lines, timezone);
  const groupedTotalCents = groups.reduce((sum, group) => sum + group.totalCents, 0);
  if (groupedTotalCents !== invoice.totalCents) {
    throw new Error(`Invoice lines total ${groupedTotalCents} does not match invoice total ${invoice.totalCents}`);
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TeachNotes";
  workbook.lastModifiedBy = "TeachNotes";
  workbook.created = invoice.issuedAt ? new Date(invoice.issuedAt) : new Date();
  workbook.modified = workbook.created;
  workbook.calcProperties.fullCalcOnLoad = true;

  const sheet = workbook.addWorksheet("Invoice", {
    views: [{ state: "frozen", ySplit: 16, showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.35, right: 0.35, top: 0.45, bottom: 0.45, header: 0.15, footer: 0.2 },
    },
    properties: { defaultRowHeight: 20 },
  });
  sheet.columns = [
    { key: "student", width: 24 },
    { key: "dates", width: 40 },
    { key: "count", width: 17 },
    { key: "rate", width: 18 },
    { key: "total", width: 21 },
  ];

  sheet.mergeCells("A1:E1");
  const title = sheet.getCell("A1");
  title.value = "STUDENT LESSON INVOICE";
  title.font = { name: FONT, size: 16, bold: true, color: { argb: WHITE } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK_GRAY } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 30;

  const fromRows: Array<[string, string]> = [
    ["Name:", invoice.tutorSnapshot.tutorName],
    ["Email:", invoice.tutorSnapshot.tutorEmail],
    ["Phone:", invoice.tutorSnapshot.tutorPhone],
    ["Address:", invoice.tutorSnapshot.tutorAddress],
  ];
  sheet.getCell("A3").value = "From:";
  sheet.getCell("A3").font = { name: FONT, bold: true };
  fromRows.forEach(([label, value], index) => {
    const row = index + 4;
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 1).font = { name: FONT, bold: true };
    sheet.getCell(row, 2).value = cleanCellText(value);
    sheet.getCell(row, 2).font = { name: FONT };
    if (row === 7) {
      sheet.mergeCells(`B${row}:E${row}`);
      sheet.getCell(row, 2).alignment = { wrapText: true, vertical: "top" };
      sheet.getRow(row).height = 30;
    }
  });

  const issued = invoice.issuedAt ? formatInTimeZone(invoice.issuedAt, timezone, "dd MMM yyyy") : "Not finalized";
  const due = invoice.dueAt ? formatInTimeZone(invoice.dueAt, timezone, "dd MMM yyyy") : "On receipt";
  const metadata: Array<[string, string]> = [
    ["Invoice no.:", invoice.number ?? "Draft"],
    ["Issued:", issued],
    ["Due:", due],
    ["Type:", invoice.kind === "consolidated" ? "All students" : "Individual student"],
  ];
  metadata.forEach(([label, value], index) => {
    const row = index + 3;
    sheet.getCell(row, 4).value = label;
    sheet.getCell(row, 4).font = { name: FONT, bold: true };
    sheet.getCell(row, 5).value = cleanCellText(value);
    sheet.getCell(row, 5).font = { name: FONT };
    sheet.getCell(row, 5).alignment = { horizontal: "right" };
  });

  sheet.getCell("A9").value = "To:";
  sheet.getCell("A9").font = { name: FONT, bold: true };
  const recipientRows: Array<[string, string]> = [
    ["Name:", invoice.recipientSnapshot.name],
    ["Email:", invoice.recipientSnapshot.email],
    ["Address:", invoice.recipientSnapshot.address],
  ];
  recipientRows.forEach(([label, value], index) => {
    const row = index + 10;
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 1).font = { name: FONT, bold: true };
    sheet.getCell(row, 2).value = cleanCellText(value);
    sheet.getCell(row, 2).font = { name: FONT };
    sheet.mergeCells(`B${row}:E${row}`);
    sheet.getCell(row, 2).alignment = { wrapText: true, vertical: "top" };
  });
  sheet.getRow(12).height = 30;

  const monthRow = 14;
  sheet.mergeCells(`A${monthRow}:E${monthRow}`);
  const monthCell = sheet.getCell(monthRow, 1);
  monthCell.value = formatInTimeZone(invoice.periodStart, timezone, "MMMM yyyy");
  monthCell.font = { name: FONT, size: 14, bold: true, underline: true };
  monthCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BLUE } };
  monthCell.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(monthRow).height = 27;
  setThinBorders([[monthCell, sheet.getCell(monthRow, 2), sheet.getCell(monthRow, 3), sheet.getCell(monthRow, 4), sheet.getCell(monthRow, 5)]]);

  const headerRow = 16;
  const headers = ["Student", "Lesson dates", "No. of Lessons", "Rate", "Price Total"];
  headers.forEach((header, index) => {
    const cell = sheet.getCell(headerRow, index + 1);
    cell.value = header;
    cell.font = { name: FONT, bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_GRAY } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  sheet.getRow(headerRow).height = 28;
  setThinBorders([headers.map((_, index) => sheet.getCell(headerRow, index + 1))]);

  const firstDataRow = headerRow + 1;
  groups.forEach((group, index) => {
    const rowNumber = firstDataRow + index;
    const cells = [1, 2, 3, 4, 5].map((column) => sheet.getCell(rowNumber, column));
    const [student, dates, count, rate, total] = cells;
    student.value = `${cleanCellText(group.studentName)}\n${formatDuration(group.durationMinutes)}`;
    dates.value = group.lessonDates.join(", ");
    count.value = group.lessonCount;
    rate.value = group.rateCents / 100;
    total.value = { formula: `C${rowNumber}*D${rowNumber}`, result: group.totalCents / 100 };

    student.font = { name: FONT, bold: true };
    student.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STUDENT_GRAY } };
    dates.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT_YELLOW } };
    count.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT_YELLOW } };
    rate.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT_YELLOW } };
    cells.forEach((cell) => {
      cell.font = { ...cell.font, name: FONT, size: 11 };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    count.alignment = { horizontal: "center", vertical: "middle" };
    rate.alignment = { horizontal: "right", vertical: "middle" };
    total.alignment = { horizontal: "right", vertical: "middle" };
    rate.numFmt = CURRENCY_FORMAT;
    total.numFmt = CURRENCY_FORMAT;
    sheet.getRow(rowNumber).height = 32;
    setThinBorders([cells]);
  });

  const lastDataRow = Math.max(firstDataRow, firstDataRow + groups.length - 1);
  if (!groups.length) {
    sheet.mergeCells(`A${firstDataRow}:E${firstDataRow}`);
    sheet.getCell(firstDataRow, 1).value = "No billable lessons";
    sheet.getCell(firstDataRow, 1).alignment = { horizontal: "center", vertical: "middle" };
    sheet.getCell(firstDataRow, 1).font = { name: FONT, italic: true, color: { argb: DARK_GRAY } };
    setThinBorders([[1, 2, 3, 4, 5].map((column) => sheet.getCell(firstDataRow, column))]);
  }

  const totalRow = lastDataRow + 2;
  sheet.mergeCells(`A${totalRow}:D${totalRow}`);
  sheet.getCell(totalRow, 1).value = "INVOICE TOTAL";
  sheet.getCell(totalRow, 5).value = groups.length
    ? { formula: `SUM(E${firstDataRow}:E${lastDataRow})`, result: invoice.totalCents / 100 }
    : invoice.totalCents / 100;
  for (let column = 1; column <= 5; column += 1) {
    const cell = sheet.getCell(totalRow, column);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK_GRAY } };
    cell.font = { name: FONT, size: 12, bold: true, color: { argb: WHITE } };
    cell.alignment = { horizontal: "right", vertical: "middle" };
  }
  sheet.getCell(totalRow, 5).numFmt = CURRENCY_FORMAT;
  sheet.getRow(totalRow).height = 27;

  const notesRow = totalRow + 2;
  sheet.mergeCells(`A${notesRow}:E${notesRow}`);
  sheet.getCell(notesRow, 1).value = "Notes:";
  sheet.getCell(notesRow, 1).font = { name: FONT, bold: true };
  sheet.getCell(notesRow, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F3F3F3" } };
  sheet.mergeCells(`A${notesRow + 1}:E${notesRow + 2}`);
  setThinBorders([
    [1, 2, 3, 4, 5].map((column) => sheet.getCell(notesRow, column)),
    [1, 2, 3, 4, 5].map((column) => sheet.getCell(notesRow + 1, column)),
    [1, 2, 3, 4, 5].map((column) => sheet.getCell(notesRow + 2, column)),
  ]);

  const bankLines = cleanCellText(invoice.tutorSnapshot.bankDetails).split(/\r?\n/).filter(Boolean);
  const bankHeight = Math.max(3, bankLines.length);
  const bankRow = notesRow + 4;
  sheet.getCell(bankRow, 1).value = "Bank details:";
  sheet.getCell(bankRow, 1).font = { name: FONT, bold: true, underline: true };
  sheet.mergeCells(`B${bankRow}:E${bankRow + bankHeight - 1}`);
  sheet.getCell(bankRow, 2).value = bankLines.length ? bankLines.join("\n") : "Not provided";
  sheet.getCell(bankRow, 2).font = { name: FONT };
  sheet.getCell(bankRow, 2).alignment = { vertical: "top", wrapText: true };
  sheet.getRow(bankRow).height = Math.max(42, bankHeight * 17);

  const ratePairs = Array.from(new Map(groups.map((group) => [
    `${group.durationMinutes}:${group.rateCents}`,
    { durationMinutes: group.durationMinutes, rateCents: group.rateCents },
  ])).values()).sort((left, right) => right.durationMinutes - left.durationMinutes || right.rateCents - left.rateCents);
  const ratesRow = bankRow + bankHeight + 1;
  sheet.getCell(ratesRow, 1).value = "Rates:";
  sheet.getCell(ratesRow, 1).font = { name: FONT, bold: true, underline: true };
  ratePairs.forEach((pair, index) => {
    const row = ratesRow + index;
    sheet.getCell(row, 2).value = formatDuration(pair.durationMinutes);
    sheet.getCell(row, 2).font = { name: FONT };
    sheet.getCell(row, 4).value = pair.rateCents / 100;
    sheet.getCell(row, 4).font = { name: FONT };
    sheet.getCell(row, 4).numFmt = CURRENCY_FORMAT;
    sheet.getCell(row, 4).alignment = { horizontal: "right" };
  });

  const finalRow = Math.max(ratesRow, ratesRow + ratePairs.length - 1);
  sheet.pageSetup.printArea = `A1:E${finalRow}`;
  sheet.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;
  sheet.headerFooter.oddFooter = `&LTeachNotes&CPage &P of &N&R${cleanCellText(invoice.number ?? "Draft")}`;
  sheet.headerFooter.evenFooter = sheet.headerFooter.oddFooter;

  const output = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.from(output);
  if (buffer.length < 4 || buffer.subarray(0, 2).toString("ascii") !== "PK") {
    throw new Error("Generated invoice workbook is not a valid XLSX archive");
  }
  return buffer;
}
