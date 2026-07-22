import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

type WorkerHandler = (event: Record<string, unknown>) => void;

function loadWorker({ cacheKeys = [], fetchImpl = vi.fn() }: { cacheKeys?: string[]; fetchImpl?: ReturnType<typeof vi.fn> } = {}) {
  const handlers = new Map<string, WorkerHandler>();
  const deletedCaches: string[] = [];
  const claim = vi.fn(async () => undefined);
  const cachedOfflineResponse = new Response("offline", { status: 200 });
  const caches = {
    keys: vi.fn(async () => cacheKeys),
    delete: vi.fn(async (key: string) => { deletedCaches.push(key); return true; }),
    open: vi.fn(async () => ({ add: vi.fn(), put: vi.fn() })),
    match: vi.fn(async () => cachedOfflineResponse),
  };
  const self = {
    location: { origin: "https://teachnotes.test" },
    clients: { claim },
    skipWaiting: vi.fn(),
    addEventListener: (name: string, handler: WorkerHandler) => handlers.set(name, handler),
  };

  vm.runInNewContext(readFileSync(join(process.cwd(), "public/sw.js"), "utf8"), {
    URL,
    Response,
    Promise,
    caches,
    fetch: fetchImpl,
    self,
  });

  return { cachedOfflineResponse, claim, deletedCaches, handlers };
}

describe("service worker policy", () => {
  it("removes every obsolete TeachNotes cache during activation", async () => {
    const worker = loadWorker({
      cacheKeys: ["teachnotes-static-v2", "teachnotes-static-v3", "teachnotes-offline-v4", "unrelated-cache"],
    });
    let activation: Promise<unknown> | undefined;

    worker.handlers.get("activate")?.({ waitUntil: (promise: Promise<unknown>) => { activation = promise; } });
    await activation;

    expect(worker.deletedCaches).toEqual(["teachnotes-static-v2", "teachnotes-static-v3"]);
    expect(worker.claim).toHaveBeenCalledOnce();
  });

  it("does not intercept deployment-specific Next.js static assets", () => {
    const worker = loadWorker();
    const respondWith = vi.fn();

    worker.handlers.get("fetch")?.({
      request: { method: "GET", mode: "no-cors", url: "https://teachnotes.test/_next/static/chunks/app.js?dpl=abc123" },
      respondWith,
    });

    expect(respondWith).not.toHaveBeenCalled();
  });

  it("falls back to the neutral offline document for failed navigations", async () => {
    const worker = loadWorker({ fetchImpl: vi.fn(async () => { throw new Error("offline"); }) });
    let responsePromise: Promise<Response> | undefined;

    worker.handlers.get("fetch")?.({
      request: { method: "GET", mode: "navigate", url: "https://teachnotes.test/today" },
      respondWith: (promise: Promise<Response>) => { responsePromise = promise; },
    });

    await expect(responsePromise).resolves.toBe(worker.cachedOfflineResponse);
  });
});
