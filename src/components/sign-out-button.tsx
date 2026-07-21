"use client";

import { LogOut } from "lucide-react";
import { clearOfflineData } from "@/lib/offline";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  async function signOut() {
    await Promise.allSettled([
      clearOfflineData(),
      "caches" in window
        ? caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("teachnotes-")).map((key) => caches.delete(key))))
        : Promise.resolve(),
    ]);
    await createClient()?.auth.signOut().catch(() => undefined);
    window.location.assign("/login");
  }
  return <button onClick={() => void signOut()} type="button"><LogOut size={16} /> Sign out and clear this device</button>;
}
