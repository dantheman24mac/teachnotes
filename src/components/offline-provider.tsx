"use client";

import { CloudOff, RefreshCw, Wifi } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushOutbox, pendingCount, prepareOfflineUser, setOfflineSessionMarker } from "@/lib/offline";

interface OfflineContextValue {
  online: boolean;
  pending: number;
  ready: boolean;
  userId: string;
  syncNow: () => Promise<void>;
}

const OfflineContext = createContext<OfflineContextValue>({ online: true, pending: 0, ready: false, userId: "demo", syncNow: async () => {} });
const subscribeToConnection = (callback: () => void) => {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
};
const connectionSnapshot = () => navigator.onLine;
const serverConnectionSnapshot = () => true;

export function useOffline() {
  return useContext(OfflineContext);
}

export function OfflineProvider({ children, userId = "demo", isBootstrapAdmin = false }: { children: React.ReactNode; userId?: string; isBootstrapAdmin?: boolean }) {
  const online = useSyncExternalStore(subscribeToConnection, connectionSnapshot, serverConnectionSnapshot);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!ready) return;
    setPending(await pendingCount(userId));
  }, [ready, userId]);

  const syncNow = useCallback(async () => {
    if (!ready || !navigator.onLine || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      await flushOutbox(userId);
    } catch {
      // The next reconnect/focus event retries with the outbox intact.
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      await refresh();
    }
  }, [ready, refresh, userId]);

  useEffect(() => {
    void navigator.serviceWorker?.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!active) return;
      const worker = navigator.serviceWorker;
      await worker?.ready.catch(() => undefined);
      if (worker && !worker.controller) {
        await new Promise<void>((resolve) => {
          const timeout = window.setTimeout(resolve, 3000);
          worker.addEventListener("controllerchange", () => {
            window.clearTimeout(timeout);
            resolve();
          }, { once: true });
        });
      }
      if (!active) return;
      await prepareOfflineUser(userId, isBootstrapAdmin);
      if (!active) return;
      // Signing out removes every TeachNotes cache. Re-prime only the neutral
      // shell when this account next opens the authenticated application.
      await fetch("/offline.html", { cache: "reload", credentials: "same-origin" }).catch(() => undefined);
      await setOfflineSessionMarker(userId);
      if (navigator.onLine) await flushOutbox(userId).catch(() => undefined);
      const initialPending = await pendingCount(userId);
      if (!active) return;
      setPending(initialPending);
      setReady(true);
    })().catch(() => {});
    return () => { active = false; };
  }, [isBootstrapAdmin, userId]);

  useEffect(() => {
    const onFocus = () => void syncNow();
    const onOnline = () => void syncNow();
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("teachnotes:sync", refresh);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("teachnotes:sync", refresh);
    };
  }, [refresh, syncNow]);

  return (
    <OfflineContext.Provider value={{ online, pending, ready, userId, syncNow }}>
      {children}
      <button className={`connectivity ${online ? "is-online" : "is-offline"}`} onClick={() => void syncNow()} type="button" aria-label="Connection and synchronization status">
        {online ? <Wifi size={15} /> : <CloudOff size={15} />}
        <span>{!ready ? "Preparing…" : online ? (pending ? `${pending} waiting` : "Synced") : `${pending} offline edit${pending === 1 ? "" : "s"}`}</span>
        {syncing && <RefreshCw size={14} className="spin" />}
      </button>
    </OfflineContext.Provider>
  );
}
