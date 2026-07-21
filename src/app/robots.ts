import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const demo = process.env.DEMO_MODE === "true";
  return {
    rules: demo
      ? { userAgent: "*", allow: "/", disallow: "/api/" }
      : { userAgent: "*", allow: ["/", "/login", "/signup"], disallow: ["/admin/", "/api/", "/change-password", "/pending"] },
  };
}
