"use client";

import { Archive, Search, UserRound } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { formatZar } from "@/lib/domain";
import type { Student } from "@/lib/types";

export function StudentList({ students, archived }: { students: Student[]; archived: boolean }) {
  const [search, setSearch] = useState("");
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return students;
    return students.filter((student) =>
      [student.displayName, student.guardianName, student.billingEmail]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(query)),
    );
  }, [search, students]);

  return <section className="section-card">
    <div className="search-row">
      <Search size={18} />
      <input
        aria-label={archived ? "Search archived students" : "Search active students"}
        placeholder={archived ? "Search archived students" : "Search your students"}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
    </div>
    <div className="student-list">
      {visible.map((student) => <Link prefetch={false} href={`/students/${student.id}`} className="student-row" key={student.id}>
        <span className="avatar">{student.displayName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
        <div>
          <strong>{student.displayName}</strong>
          <small>{archived && student.deletedAt
            ? `Archived ${new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium" }).format(new Date(student.deletedAt))}`
            : student.guardianName || student.billingEmail || "No billing contact"}</small>
        </div>
        {archived
          ? <span className="archive-badge"><Archive size={13} /> Archived</span>
          : <div className="student-rate"><strong>{formatZar(student.defaultRateCents)}</strong><small>{student.defaultDurationMinutes} minutes</small></div>}
      </Link>)}
      {visible.length === 0 && <div className="empty-state">
        {archived ? <Archive /> : <UserRound />}
        <h3>{search ? "No matching students" : archived ? "No archived students" : "No active students"}</h3>
        <p>{search
          ? "Try a different name, billing contact or email address."
          : archived
            ? "Students you archive will appear here with their lesson history."
            : "Add your first student to start scheduling lessons."}</p>
      </div>}
    </div>
  </section>;
}
