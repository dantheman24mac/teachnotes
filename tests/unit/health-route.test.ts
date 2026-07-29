import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";

describe("health route", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports the exact release SHA supplied by the runtime", async () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    vi.stubEnv("TEACHNOTES_RELEASE_SHA", sha);

    const response = GET();

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "teachnotes",
      releaseSha: sha,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("does not expose malformed release metadata", async () => {
    vi.stubEnv("TEACHNOTES_RELEASE_SHA", "not-a-commit");

    const response = GET();

    await expect(response.json()).resolves.toMatchObject({
      releaseSha: null,
    });
  });
});
