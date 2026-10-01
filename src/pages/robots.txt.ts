/**
 * robots.txt. Two modes:
 * - preview / dev (draft content): keep every crawler out entirely, so the
 *   preview domain can never leak unfinished content into search results;
 * - production: allow everything and point at the sitemap.
 *
 * Like the sitemap, this prerenders to a static file in production builds.
 */
import type { APIRoute } from "astro";
import { siteOrigin } from "../lib/seo";

export const GET: APIRoute = async ({ url, site }) => {
  const preview =
    import.meta.env.DEV || import.meta.env.IS_PREVIEW === "true";
  // No trailing slashes anywhere (project convention): robots prefix
  // matching still covers every subpath (`/api` blocks `/api/book` too).
  const body = preview
    ? "User-agent: *\nDisallow: /\n"
    : "User-agent: *\n" +
      "Allow: /\n" +
      "Disallow: /api\n" +
      "Disallow: /guide\n" +
      "Disallow: /global\n" +
      "Disallow: /seances\n" +
      "\n" +
      "Sitemap: " +
      siteOrigin(url, site) +
      "/sitemap.xml\n";
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
