"use client";

import { Clock3, ShieldX } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { clearOfflineData, clearOfflineSessionMarker } from "@/lib/offline";

type AccountStatus = "pending" | "approved" | "rejected";

export function PendingStatus({ initialStatus, email, userId }: { initialStatus: AccountStatus; email: string; userId: string }) {
  const [status, setStatus] = useState(initialStatus);
  const [checking, setChecking] = useState(false);

  const checkStatus = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    setChecking(true);
    try {
      const response = await fetch("/api/account-status", { cache: "no-store", headers: { accept: "application/json" } });
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (!response.ok) return;
      const result = await response.json() as { status: AccountStatus; mustChangePassword: boolean };
      setStatus(result.status);
      if (result.status === "rejected") await clearOfflineData(userId);
      if (result.status === "approved") window.location.replace(result.mustChangePassword ? "/change-password" : "/today");
    } finally {
      setChecking(false);
    }
  }, [userId]);

  useEffect(() => {
    if (initialStatus === "rejected") void clearOfflineData(userId);
    else void clearOfflineSessionMarker();
    const interval = window.setInterval(() => void checkStatus(), 5000);
    const onFocus = () => void checkStatus();
    const onVisibility = () => { if (document.visibilityState === "visible") void checkStatus(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [checkStatus, initialStatus, userId]);

  const rejected = status === "rejected";
  return <main className="status-page"><section className="status-card">
    <div className={`status-icon ${rejected ? "is-rejected" : ""}`}>{rejected ? <ShieldX /> : <Clock3 />}</div>
    <p className="eyebrow">{rejected ? "Request not approved" : "Approval pending"}</p>
    <h1>{rejected ? "Your account is not active" : "Your request is in the queue"}</h1>
    <p className="subtle">{rejected ? "The administrator declined or revoked this account. They can approve it later if circumstances change." : "You are signed in. This page will open your Today view automatically after the administrator approves you."}</p>
    <dl className="status-details"><div><dt>Account</dt><dd>{email}</dd></div><div><dt>Status</dt><dd>{rejected ? "Rejected" : checking ? "Checking…" : "Waiting for approval"}</dd></div></dl>
    <button className="button-secondary full-width" type="button" onClick={() => void checkStatus()} disabled={checking}>{checking ? "Checking…" : "Check now"}</button>
    <div className="status-signout"><SignOutButton userId={userId} /></div>
  </section></main>;
}
