"use client";

import { CalendarDays, ClipboardList, GraduationCap, Menu, ReceiptText, Settings, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const links = [
  { href: "/today", label: "Today", icon: ClipboardList },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/students", label: "Students", icon: Users },
  { href: "/invoices", label: "Invoices", icon: ReceiptText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children, demoMode }: { children: React.ReactNode; demoMode: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <div className="app-frame">
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="brand"><span className="brand-mark"><GraduationCap size={22} /></span><span>TeachNotes</span></div>
        <button className="sidebar-close" type="button" onClick={() => setOpen(false)} aria-label="Close menu"><X /></button>
        <nav aria-label="Primary navigation">
          {links.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return <Link prefetch={false} key={href} href={href} className={active ? "active" : ""} onClick={() => setOpen(false)}><Icon size={19} /><span>{label}</span></Link>;
          })}
        </nav>
        <div className="sidebar-foot">
          {demoMode && <span className="demo-pill">Demo data</span>}
          <p>Calm admin for focused teaching.</p>
        </div>
      </aside>
      {open && <button className="scrim" type="button" onClick={() => setOpen(false)} aria-label="Close navigation" />}
      <div className="content-frame">
        <header className="mobile-header"><button type="button" onClick={() => setOpen(true)} aria-label="Open menu"><Menu /></button><span>TeachNotes</span></header>
        <main className="page-shell">{children}</main>
      </div>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {links.slice(0, 4).map(({ href, label, icon: Icon }) => <Link prefetch={false} key={href} href={href} className={pathname.startsWith(href) ? "active" : ""}><Icon size={19} /><span>{label}</span></Link>)}
      </nav>
    </div>
  );
}
