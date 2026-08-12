import { afterEach, describe, expect, it, vi } from "vitest";
import { assertEnvironmentConfiguration, parseEnvironment } from "@/lib/runtime-environment";

describe("runtime environment", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("parses every supported environment", () => {
    expect(parseEnvironment("production")).toBe("production");
    expect(parseEnvironment("staging")).toBe("staging");
    expect(parseEnvironment("demo")).toBe("demo");
    expect(() => parseEnvironment("test")).toThrow(/Invalid/);
  });

  it("rejects production URLs in staging", () => {
    vi.stubEnv("TEACHNOTES_ENVIRONMENT", "staging");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://teachnotes.fyi");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://api.teachnotes.fyi");
    vi.stubEnv("SUPABASE_INTERNAL_URL", "http://kong:8000");
    expect(() => assertEnvironmentConfiguration("staging")).toThrow(/staging app URL/);
  });

  it("accepts only the selected staging endpoints", () => {
    vi.stubEnv("TEACHNOTES_ENVIRONMENT", "staging");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.teachnotes.fyi");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://staging-api.teachnotes.fyi");
    vi.stubEnv("SUPABASE_INTERNAL_URL", "http://kong:8000");
    expect(() => assertEnvironmentConfiguration("staging")).not.toThrow();
  });
});
