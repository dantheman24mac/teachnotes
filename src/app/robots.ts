import type { MetadataRoute } from "next";
import { parseEnvironment } from "@/lib/runtime-environment";

export default function robots(): MetadataRoute.Robots {
  const environment = parseEnvironment();
  if (environment === "staging") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  const demo = environment === "demo";
  return {
    rules: demo
      ? { userAgent: "*", allow: "/", disallow: "/api/" }
      : { userAgent: "*", allow: ["/", "/login", "/signup"], disallow: ["/admin/", "/api/", "/change-password", "/pending"] },
  };
}
