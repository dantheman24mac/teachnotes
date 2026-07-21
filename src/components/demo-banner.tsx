"use client";

import { RotateCcw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { clearOfflineData } from "@/lib/offline";

export function DemoBanner() {
  const resetDemo = async () => {
    await clearOfflineData("demo");
    window.location.assign("/today");
  };

  return (
    <aside className="demo-banner" aria-label="Portfolio demo information">
      <span><ShieldCheck size={16} /> Synthetic portfolio demo</span>
      <p>All names and records are fictional. Explore freely—changes never reach the production database.</p>
      <div>
        <Link href="https://github.com/dantheman24mac/teachnotes">View source</Link>
        <button type="button" onClick={() => void resetDemo()}><RotateCcw size={14} /> Reset demo</button>
      </div>
    </aside>
  );
}
