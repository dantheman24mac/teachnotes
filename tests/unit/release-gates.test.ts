import { describe, expect, it } from "vitest";
import { assertStagingIsolationValue, requireProductionMain, validateStagingApproval } from "@/lib/release-gates";

const sha = "0123456789abcdef0123456789abcdef01234567";
const other = "1123456789abcdef0123456789abcdef01234567";

describe("release gates", () => {
  it("rejects production URLs, networks, volumes and release roots in staging", () => {
    for (const value of [
      "https://teachnotes.fyi", "https://api.teachnotes.fyi", "supabase_default",
      "teachnotes-demo", "/srv/teachnotes/supabase/volumes/db/data",
      "/home/dantheman/releases/teachnotes/deadbeef",
    ]) expect(() => assertStagingIsolationValue(value)).toThrow(/rejected/);
    expect(() => assertStagingIsolationValue("https://staging.teachnotes.fyi teachnotes-staging")).not.toThrow();
  });

  it("permits only the exact origin/main tip in production", () => {
    expect(() => requireProductionMain("main", sha, sha)).not.toThrow();
    expect(() => requireProductionMain("feature", sha, sha)).toThrow(/main/);
    expect(() => requireProductionMain("main", sha, other)).toThrow(/exact/);
  });

  it("requires matching current staging and public health SHAs", () => {
    const approval = { sha, healthSha: sha, deployedAt: "2026-08-05T10:00:00Z", approvedAt: "2026-08-05T10:05:00Z" };
    expect(() => validateStagingApproval(approval, sha, sha, sha)).not.toThrow();
    expect(() => validateStagingApproval(approval, sha, other, sha)).toThrow(/match/);
    expect(() => validateStagingApproval(approval, sha, sha, other)).toThrow(/match/);
  });

  it("rejects approvals older than their staging deployment", () => {
    const stale = { sha, healthSha: sha, deployedAt: "2026-08-05T10:05:00Z", approvedAt: "2026-08-05T10:00:00Z" };
    expect(() => validateStagingApproval(stale, sha, sha, sha)).toThrow(/stale/);
  });
});
