"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { Student } from "@/lib/types";

export function InvoiceBuilder({ students, month }: { students: Student[]; month: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const kind = search.get("kind") ?? "consolidated";
  const student = search.get("student") ?? "";
  function update(next: { kind?: string; student?: string; month?: string }) {
    const params = new URLSearchParams(search.toString());
    Object.entries(next).forEach(([key, value]) => value ? params.set(key, value) : params.delete(key));
    router.replace(`/invoices/new?${params}`);
  }
  return <div className="builder-controls"><label>Invoice month<input type="month" value={month} onChange={(event) => update({ month: event.target.value })} /></label><label>Invoice type<select value={kind} onChange={(event) => update({ kind: event.target.value, student: event.target.value === "consolidated" ? "" : student })}><option value="consolidated">All students</option><option value="student">One student</option></select></label>{kind === "student" && <label>Student<select value={student} onChange={(event) => update({ student: event.target.value })}><option value="">Choose student</option>{students.map((item) => <option key={item.id} value={item.id}>{item.displayName}{item.deletedAt ? " (Archived)" : ""}</option>)}</select></label>}</div>;
}
