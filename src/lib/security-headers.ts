const turnstileOrigin = "https://challenges.cloudflare.com";

function validApiOrigin(value: string | undefined, allowHttp: boolean) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (allowHttp && url.protocol === "http:") ? url.origin : null;
  } catch {
    return null;
  }
}

export const staticSecurityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  },
] as const;

export function buildContentSecurityPolicy({
  nonce,
  development = false,
  supabaseUrl,
}: {
  nonce: string;
  development?: boolean;
  supabaseUrl?: string;
}) {
  const connectSources = ["'self'", turnstileOrigin];
  const supabaseOrigin = validApiOrigin(supabaseUrl, development);
  if (supabaseOrigin) connectSources.push(supabaseOrigin);

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${turnstileOrigin}${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    `frame-src ${turnstileOrigin}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}
