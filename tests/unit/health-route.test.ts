import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";

describe("health route", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports the exact release SHA supplied by the runtime", async () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    vi.stubEnv("TEACHNOTES_RELEASE_SHA", sha);
    vi.stubEnv("TEACHNOTES_ENVIRONMENT", "staging");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.teachnotes.fyi");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://staging-api.teachnotes.fyi");
    vi.stubEnv("SUPABASE_INTERNAL_URL", "http://kong:8000");

    const response = GET();

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "teachnotes",
      releaseSha: sha,
      environment: "staging",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("does not expose malformed release metadata", async () => {
    vi.stubEnv("TEACHNOTES_RELEASE_SHA", "not-a-commit");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://teachnotes.fyi");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://api.teachnotes.fyi");
    vi.stubEnv("SUPABASE_INTERNAL_URL", "http://kong:8000");

    const response = GET();

    await expect(response.json()).resolves.toMatchObject({
      releaseSha: null,
    });
  });
});
