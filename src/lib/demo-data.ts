import { addDays, addMinutes, startOfDay, subDays } from "date-fns";
import type { BusinessSettings, Invoice, Lesson, Student } from "./types";

// Every identity, address and financial value in this module is fictional and
// exists only for local development, automated tests and demo.teachnotes.fyi.
const today = startOfDay(new Date());
const at = (dayOffset: number, hour: number, minute = 0) =>
  addMinutes(addDays(today, dayOffset), hour * 60 + minute).toISOString();

export const demoStudents: Student[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    displayName: "Liam Jacobs",
    guardianName: "Megan Jacobs",
    billingEmail: "megan@example.com",
    billingAddress: "14 Protea Road, Cape Town",
    defaultDurationMinutes: 60,
    defaultRateCents: 45000,
    active: true,
    syncRevision: 1,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    displayName: "Amahle Dlamini",
    guardianName: "Thandi Dlamini",
    billingEmail: "thandi@example.com",
    defaultDurationMinutes: 45,
    defaultRateCents: 38000,
    active: true,
    syncRevision: 2,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    displayName: "Noah Williams",
    guardianName: "Chris Williams",
    billingEmail: "chris@example.com",
    defaultDurationMinutes: 30,
    defaultRateCents: 28000,
    active: true,
    syncRevision: 3,
  },
];

export const demoLessons: Lesson[] = [
  {
    id: "a1111111-1111-4111-8111-111111111111",
    studentId: demoStudents[0].id,
    studentName: demoStudents[0].displayName,
    startsAt: at(0, 9),
    durationMinutes: 60,
    rateCents: 45000,
    status: "scheduled",
    billingOverride: "default",
    notes: "Continue quadratic equations and check factorisation fluency.",
    version: 1,
    syncRevision: 8,
  },
  {
    id: "a2222222-2222-4222-8222-222222222222",
    studentId: demoStudents[1].id,
    studentName: demoStudents[1].displayName,
    startsAt: at(0, 14, 30),
    durationMinutes: 45,
    rateCents: 38000,
    status: "scheduled",
    billingOverride: "default",
    notes: "Review essay outline, then revise the opening paragraph.",
    version: 2,
    syncRevision: 9,
  },
  {
    id: "a3333333-3333-4333-8333-333333333333",
    studentId: demoStudents[2].id,
    studentName: demoStudents[2].displayName,
    startsAt: at(0, 17),
    durationMinutes: 30,
    rateCents: 28000,
    status: "scheduled",
    billingOverride: "default",
    notes: "Sight words and a short guided-reading passage.",
    version: 1,
    syncRevision: 10,
  },
  ...Array.from({ length: 12 }, (_, index): Lesson => {
    const student = demoStudents[index % demoStudents.length];
    const date = subDays(today, index + 1);
    date.setHours(15 + (index % 3), 0, 0, 0);
    return {
      id: `b${String(index).padStart(7, "0")}-0000-4000-8000-000000000000`,
      studentId: student.id,
      studentName: student.displayName,
      startsAt: date.toISOString(),
      durationMinutes: student.defaultDurationMinutes,
      rateCents: student.defaultRateCents,
      status: index === 4 ? "no_show" : index === 7 ? "canceled_rescheduled" : "attended",
      billingOverride: "default",
      notes: [
        "Strong progress. Revisited last week’s goal and added one stretch exercise.",
        "Needed a slower start, then completed the core activity independently.",
        "Reviewed homework corrections and set a short practice task for next time.",
      ][index % 3],
      version: 1,
      syncRevision: 20 + index,
    };
  }),
];

export const demoSettings: BusinessSettings = {
  tutorName: "Alex Morgan",
  tutorEmail: "alex@example.com",
  tutorPhone: "+27 82 555 0142",
  tutorAddress: "Woodstock, Cape Town",
  defaultPayerName: "Bright Futures Learning",
  defaultPayerEmail: "accounts@brightfutures.example",
  defaultPayerAddress: "Cape Town, South Africa",
  paymentTermsDays: 7,
  bankDetails: "Bank: Example Bank\nAccount: 000 123 456\nReference: Invoice number",
  invoicePrefix: "INV",
  timezone: "Africa/Johannesburg",
  currency: "ZAR",
};

export const demoInvoices: Invoice[] = [
  {
    id: "c1111111-1111-4111-8111-111111111111",
    number: "INV-2026-0007",
    kind: "consolidated",
    status: "finalized",
    periodStart: new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString(),
    periodEnd: new Date(today.getFullYear(), today.getMonth(), 0).toISOString(),
    recipientName: "Bright Futures Learning",
    totalCents: 362000,
    issuedAt: subDays(today, 8).toISOString(),
    dueAt: subDays(today, 1).toISOString(),
    lines: [],
  },
];
