export interface StagingApproval {
  sha: string;
  deployedAt: string;
  approvedAt: string;
  healthSha: string;
}

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const STAGING_REJECTIONS = [
  "https://teachnotes.fyi",
  "https://api.teachnotes.fyi",
  "supabase_default",
  "teachnotes-demo",
  "/srv/teachnotes/supabase/volumes",
  "/home/dantheman/releases/teachnotes/",
] as const;

export function isExactSha(value: string) {
  return SHA_PATTERN.test(value);
}

export function assertStagingIsolationValue(value: string) {
  const rejected = STAGING_REJECTIONS.find((candidate) => value.includes(candidate));
  if (rejected) throw new Error(`Production value rejected in staging: ${rejected}`);
}

export function requireProductionMain(branch: string, localSha: string, mainTip: string) {
  if (branch !== "main") throw new Error("Production releases must come from main");
  if (!isExactSha(localSha) || localSha !== mainTip) {
    throw new Error("Production release must be the exact origin/main tip");
  }
}

export function validateStagingApproval(
  approval: StagingApproval,
  requestedSha: string,
  currentStagingSha: string,
  publicHealthSha: string,
) {
  if (![requestedSha, currentStagingSha, publicHealthSha, approval.sha, approval.healthSha].every(isExactSha)) {
    throw new Error("Approval contains invalid release metadata");
  }
  if (
    approval.sha !== requestedSha || approval.healthSha !== requestedSha ||
    currentStagingSha !== requestedSha || publicHealthSha !== requestedSha
  ) {
    throw new Error("Staging approval and health must match the requested SHA");
  }
  const deployedAt = Date.parse(approval.deployedAt);
  const approvedAt = Date.parse(approval.approvedAt);
  if (!Number.isFinite(deployedAt) || !Number.isFinite(approvedAt) || approvedAt < deployedAt) {
    throw new Error("Staging approval is stale");
  }
}
