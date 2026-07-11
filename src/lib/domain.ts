import type { BillingOverride, LessonStatus } from "./types";

export function isBillable(
  status: LessonStatus,
  override: BillingOverride = "default",
): boolean {
  if (override === "billable") return true;
  if (override === "non_billable") return false;
  return status === "attended" || status === "no_show";
}

export function formatZar(cents: number): string {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(cents / 100);
}

export function invoiceNumber(prefix: string, year: number, sequence: number) {
  return `${prefix}-${year}-${String(sequence).padStart(4, "0")}`;
}

export function calculateInvoiceTotal(
  lessons: Array<{
    status: LessonStatus;
    billingOverride: BillingOverride;
    rateCents: number;
    invoiced?: boolean;
  }>,
) {
  return lessons.reduce(
    (total, lesson) =>
      !lesson.invoiced && isBillable(lesson.status, lesson.billingOverride)
        ? total + lesson.rateCents
        : total,
    0,
  );
}

export const STATUS_LABELS: Record<LessonStatus, string> = {
  scheduled: "Scheduled",
  attended: "Attended",
  canceled_rescheduled: "Cancelled / rescheduled",
  no_show: "No-show",
};
