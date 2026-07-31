export type LessonStatus =
  | "scheduled"
  | "attended"
  | "canceled_rescheduled"
  | "no_show";

export type BillingOverride = "default" | "billable" | "non_billable";
export type InvoiceKind = "consolidated" | "student";
export type InvoiceStatus = "draft" | "finalized" | "void";

export interface Student {
  id: string;
  ownerId?: string;
  displayName: string;
  guardianName?: string | null;
  billingEmail?: string | null;
  billingAddress?: string | null;
  defaultDurationMinutes: number;
  defaultRateCents: number;
  active: boolean;
  deletedAt?: string | null;
  syncRevision?: number;
}

export interface Lesson {
  id: string;
  studentId: string;
  studentName: string;
  startsAt: string;
  durationMinutes: number;
  rateCents: number;
  status: LessonStatus;
  billingOverride: BillingOverride;
  notes: string;
  version: number;
  syncRevision: number;
  invoiced?: boolean;
}

export interface LessonSeries {
  id: string;
  studentId: string;
  startsAtLocal: string;
  timezone: string;
  frequency: "weekly" | "fortnightly";
  weekdays: number[];
  until?: string | null;
  exclusions: string[];
}

export interface BusinessSettings {
  tutorName: string;
  tutorEmail: string;
  tutorPhone: string;
  tutorAddress: string;
  defaultPayerName: string;
  defaultPayerEmail: string;
  defaultPayerAddress: string;
  paymentTermsDays: number;
  bankDetails: string;
  invoicePrefix: string;
  timezone: string;
  currency: "ZAR";
}

export interface InvoiceLine {
  id?: string;
  lessonId: string;
  studentName: string;
  lessonDate: string;
  durationMinutes: number;
  status: LessonStatus;
  amountCents: number;
}

export interface Invoice {
  id: string;
  number: string | null;
  kind: InvoiceKind;
  studentId?: string | null;
  status: InvoiceStatus;
  periodStart: string;
  periodEnd: string;
  recipientName: string;
  totalCents: number;
  issuedAt?: string | null;
  dueAt?: string | null;
  voidReason?: string | null;
  lines: InvoiceLine[];
}

export interface LessonPatch {
  notes?: string;
  status?: LessonStatus;
  billingOverride?: BillingOverride;
}

export interface SyncOperation {
  id: string;
  lessonId: string;
  baseVersion: number;
  patch: LessonPatch;
  clientTimestamp: string;
}

export interface SyncConflict {
  operation: SyncOperation;
  serverLesson: Lesson;
}
