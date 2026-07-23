import type { NextRequest } from "next/server";
import { buildContentSecurityPolicy, preventResponseTransformation } from "@/lib/security-headers";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    development: process.env.NODE_ENV === "development",
    supabaseUrl:
      process.env.DEMO_MODE === "true" ? undefined : process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = await updateSession(request, requestHeaders);
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  // Cloudflare Email Address Obfuscation rewrites visible account emails before
  // React hydrates, so authenticated pages must opt out of edge HTML transforms.
  response.headers.set("Cache-Control", preventResponseTransformation(response.headers.get("Cache-Control")));
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons|sw.js|offline.html).*)"],
};
