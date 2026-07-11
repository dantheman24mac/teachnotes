"use client";

import { AlertTriangle, Check, CloudOff, RefreshCw, Wifi } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { flushOutbox, getConflicts, pendingCount, resolveConflict } from "@/lib/offline";
import type { SyncConflict } from "@/lib/types";

interface OfflineContextValue {
  online: boolean;
  pending: number;
  syncNow: () => Promise<void>;
}

const OfflineContext = createContext<OfflineContextValue>({ online: true, pending: 0, syncNow: async () => {} });
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

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const online = useSyncExternalStore(subscribeToConnection, connectionSnapshot, serverConnectionSnapshot);
  const [pending, setPending] = useState(0);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    setPending(await pendingCount());
    setConflicts(await getConflicts());
  }, []);

  const syncNow = useCallback(async () => {
    if (!navigator.onLine || syncing) return;
    setSyncing(true);
    try {
      await flushOutbox();
    } catch {
      // The next reconnect/focus event retries with the outbox intact.
    } finally {
      setSyncing(false);
      await refresh();
    }
  }, [refresh, syncing]);

  useEffect(() => {
    navigator.serviceWorker?.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    const onOnline = () => {
      void syncNow();
    };
    const onFocus = () => void syncNow();
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    window.addEventListener("teachnotes:sync", refresh);
    const initialRefresh = window.setTimeout(() => void refresh(), 0);
    return () => {
      window.clearTimeout(initialRefresh);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("teachnotes:sync", refresh);
    };
  }, [refresh, syncNow]);

  const resolve = async (id: string, choice: "server" | "local") => {
    await resolveConflict(id, choice);
    await refresh();
    if (choice === "local") await syncNow();
  };

  return (
    <OfflineContext.Provider value={{ online, pending, syncNow }}>
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
