import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, staticSecurityHeaders } from "@/lib/security-headers";

describe("security headers", () => {
  it("builds a nonce-based policy for production and Turnstile", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "unique-nonce",
      supabaseUrl: "https://api.teachnotes.fyi/auth/v1",
    });

    expect(policy).toContain("script-src 'self' 'nonce-unique-nonce' 'strict-dynamic'");
    expect(policy).toContain("connect-src 'self' https://challenges.cloudflare.com https://api.teachnotes.fyi");
    expect(policy).toContain("frame-src https://challenges.cloudflare.com");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it("does not add invalid or non-HTTPS API origins", () => {
    const policy = buildContentSecurityPolicy({ nonce: "n", supabaseUrl: "http://127.0.0.1:54321" });
    expect(policy).not.toContain("127.0.0.1:54321");
  });

  it("allows the local Supabase origin only in development", () => {
    const policy = buildContentSecurityPolicy({ nonce: "n", development: true, supabaseUrl: "http://127.0.0.1:54321" });
    expect(policy).toContain("http://127.0.0.1:54321");
    expect(policy).toContain("'unsafe-eval'");
  });

  it("publishes the expected static browser protections", () => {
    expect(Object.fromEntries(staticSecurityHeaders.map(({ key, value }) => [key, value]))).toMatchObject({
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
  });
});
