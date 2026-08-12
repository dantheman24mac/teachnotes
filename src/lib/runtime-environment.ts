export type TeachNotesEnvironment = "production" | "staging" | "demo";

const EXPECTED = {
  production: {
    app: "https://teachnotes.fyi",
    publicSupabase: "https://api.teachnotes.fyi",
    internalSupabase: "http://kong:8000",
  },
  staging: {
    app: "https://staging.teachnotes.fyi",
    publicSupabase: "https://staging-api.teachnotes.fyi",
    internalSupabase: "http://kong:8000",
  },
} as const;

export function parseEnvironment(
  value = process.env.TEACHNOTES_ENVIRONMENT,
): TeachNotesEnvironment {
  if (value === "production" || value === "staging" || value === "demo") return value;
  if (value) throw new Error(`Invalid TEACHNOTES_ENVIRONMENT: ${value}`);
  return process.env.DEMO_MODE === "true" || !process.env.NEXT_PUBLIC_SUPABASE_URL
    ? "demo"
    : "production";
}

export function assertEnvironmentConfiguration(
  environment = parseEnvironment(),
) {
  // Local development historically infers its mode from available Supabase
  // variables. Pi deployments always select an explicit, strict environment.
  if (!process.env.TEACHNOTES_ENVIRONMENT) return;
  if (environment === "demo") {
    if (process.env.TEACHNOTES_ENVIRONMENT === "demo" && process.env.DEMO_MODE !== "true") {
      throw new Error("An explicit demo environment requires DEMO_MODE=true");
    }
    return;
  }

  if (process.env.DEMO_MODE === "true") {
    throw new Error(`${environment} cannot run with DEMO_MODE=true`);
  }

  const expected = EXPECTED[environment];
  const actual = {
    app: process.env.NEXT_PUBLIC_APP_URL,
    publicSupabase: process.env.NEXT_PUBLIC_SUPABASE_URL,
    internalSupabase: process.env.SUPABASE_INTERNAL_URL,
  };

  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    if (actual[key] !== expected[key]) {
      throw new Error(
        `${environment} ${key} URL must be ${expected[key]}; received ${actual[key] ?? "unset"}`,
      );
    }
  }
}

export function isStagingEnvironment() {
  return parseEnvironment() === "staging";
}
