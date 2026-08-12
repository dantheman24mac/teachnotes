import { assertEnvironmentConfiguration, parseEnvironment } from "@/lib/runtime-environment";

function releaseSha() {
  const value = process.env.TEACHNOTES_RELEASE_SHA;
  return value && /^[0-9a-f]{40}$/.test(value) ? value : null;
}

export function GET() {
  const environment = parseEnvironment();
  assertEnvironmentConfiguration(environment);
  return Response.json(
    {
      ok: true,
      service: "teachnotes",
      mode: environment === "demo" ? "demo" : "production",
      environment,
      releaseSha: releaseSha(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
