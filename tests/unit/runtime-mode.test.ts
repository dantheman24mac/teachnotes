import { afterEach, describe, expect, it, vi } from "vitest";
import { isDemoMode, isSupabaseConfigured } from "@/lib/supabase/server";

describe("runtime mode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("forces the demo to ignore Supabase configuration", () => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://api.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");

    expect(isSupabaseConfigured()).toBe(false);
    expect(isDemoMode()).toBe(true);
  });
});
