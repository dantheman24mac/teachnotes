"use client";

import { AlertTriangle, Check, CloudOff, RefreshCw, Wifi } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushOutbox, getConflicts, pendingCount, prepareOfflineUser, resolveConflict, setOfflineSessionMarker } from "@/lib/offline";
import type { SyncConflict } from "@/lib/types";

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
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!ready) return;
    setPending(await pendingCount(userId));
    setConflicts(await getConflicts(userId));
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
      const [initialPending, initialConflicts] = await Promise.all([pendingCount(userId), getConflicts(userId)]);
      if (!active) return;
      setPending(initialPending);
      setConflicts(initialConflicts);
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

  const resolve = async (id: string, choice: "server" | "local") => {
    await resolveConflict(userId, id, choice);
    await refresh();
    if (choice === "local") await syncNow();
  };

  return (
    <OfflineContext.Provider value={{ online, pending, ready, userId, syncNow }}>
      {children}
      <button className={`connectivity ${online ? "is-online" : "is-offline"}`} onClick={() => void syncNow()} type="button" aria-label="Connection and synchronization status">
        {online ? <Wifi size={15} /> : <CloudOff size={15} />}
        <span>{online ? (pending ? `${pending} waiting` : "Synced") : `${pending} offline edit${pending === 1 ? "" : "s"}`}</span>
        {syncing && <RefreshCw size={14} className="spin" />}
      </button>
      {conflicts.length > 0 && (
        <aside className="conflict-panel" role="alert" aria-live="polite">
          <div className="conflict-title"><AlertTriangle size={18} /> Sync decision needed</div>
          <p>This lesson changed elsewhere while you were offline. Your version is preserved.</p>
          {conflicts.map((conflict) => (
            <div className="conflict-item" key={conflict.operation.id}>
              <strong>{conflict.serverLesson.studentName}</strong>
              <div className="conflict-actions">
                <button onClick={() => void resolve(conflict.operation.id, "server")} type="button">Use server</button>
                <button className="primary-small" onClick={() => void resolve(conflict.operation.id, "local")} type="button"><Check size={14} /> Keep mine</button>
              </div>
            </div>
          ))}
        </aside>
      )}
    </OfflineContext.Provider>
  );
}
