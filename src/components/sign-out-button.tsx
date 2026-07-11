"use client";

import { LogOut } from "lucide-react";
import { clearOfflineData } from "@/lib/offline";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  async function signOut() {
    await clearOfflineData();
    if ("caches" in window) await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
    await createClient()?.auth.signOut();
    window.location.assign("/login");
  }
  return <button onClick={() => void signOut()} type="button"><LogOut size={16} /> Sign out and clear this device</button>;
}
