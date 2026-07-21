import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { offlineDatabaseName } from "@/lib/offline";

describe("offline account isolation", () => {
  it("uses a different IndexedDB database for every account", () => {
    expect(offlineDatabaseName("user-a")).not.toBe(offlineDatabaseName("user-b"));
    expect(offlineDatabaseName("2f20c71b-14d8-4df5-a593-f2d2324af050")).toBe("teachnotes-user-2f20c71b-14d8-4df5-a593-f2d2324af050");
  });

  it("uses a neutral offline document instead of caching authenticated HTML", () => {
    const worker = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");
    const shell = readFileSync(join(process.cwd(), "public/offline.html"), "utf8");
    expect(worker).toContain('const OFFLINE_SHELL = "/offline.html"');
    expect(worker).not.toContain("teachnotes-user-shell");
    expect(worker).not.toContain("offline-warm");
    expect(shell).toContain('localStorage.getItem("teachnotes-active-user")');
    expect(shell).toContain("teachnotes-user-");
  });
});
