import type { MetadataRoute } from "next";

// The dashboard (app.getelliot.eu) is private: keep it out of search results.
// The public website is getelliot.eu.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
