"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import { clearLocalSession } from "@/app/actions";
import { clearOfflineData } from "@/lib/offline";

export function SignOutButton({ userId }: { userId?: string }) {
  const [working, setWorking] = useState(false);

  async function signOut() {
    if (working) return;
    setWorking(true);
    try {
      await Promise.allSettled([
        clearOfflineData(userId),
        "caches" in window
          ? caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("teachnotes-")).map((key) => caches.delete(key))))
          : Promise.resolve(),
      ]);
      await clearLocalSession().catch(() => undefined);
    } finally {
      window.location.replace("/login");
    }
  }
  return <button onClick={() => void signOut()} type="button" disabled={working} aria-busy={working}><LogOut size={16} /> {working ? "Signing out…" : "Sign out and clear this device"}</button>;
}
