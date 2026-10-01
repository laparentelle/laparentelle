/**
 * Sitemap generated from the published Storyblok stories.
 *
 * Most routes are SSR (`prerender = false`), so a static sitemap plugin
 * would only see the homepage. This endpoint lists every public story
 * instead: pages, team members with an active page, and activities.
 * Preview-only stories (`global`, `seances/*`) are always excluded, as are
 * pages the editor marked "non indexée".
 *
 * In production (`output: 'static'`) this prerenders to a static file at
 * build time; in preview it renders on demand.
 */
import type { APIRoute } from "astro";
import { isIndexable, normalisePath, siteOrigin } from "../lib/seo";

interface SitemapEntry {
  loc: string;
  lastmod?: string;
  changefreq: string;
  priority: string;
}

function storyPath(story: { full_slug?: string }): string | null {
  const slug = story.full_slug || "";
  if (!slug) return null;
  if (slug === "home") return "/";
  // Same no-trailing-slash form as canonical URLs.
  return normalisePath("/" + slug);
}

// Raw fetch (not `useStoryblokApi`, which is page-context only): this also
// runs inside API routes and at build time.
async function publishedStories(token: string): Promise<any[]> {
  const out: any[] = [];
  let page = 1;
  for (;;) {
    const url =
      "https://api.storyblok.com/v2/cdn/stories?token=" +
      encodeURIComponent(token) +
      "&version=published&per_page=100&page=" +
      page;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Storyblok " + res.status);
    const data = await res.json();
    const stories: any[] = data.stories || [];
    if (stories.length === 0) break;
    for (const s of stories) out.push(s);
    page += 1;
    if (page > 20) break;
  }
  return out;
}

export const GET: APIRoute = async ({ url, site }) => {
  let entries: SitemapEntry[] = [];
  try {
    const token = import.meta.env.STORYBLOK_TOKEN;
    if (!token || token === "placeholder-token") throw new Error("no Storyblok token");
    const origin = siteOrigin(url, site);
    const stories = await publishedStories(token);
    const seen: string[] = [];
    for (const story of stories) {
      const content = story.content || {};
      const component = content.component;
      // Only public page types. Everything else (global settings, sessions,
      // unknown components) stays out of the sitemap.
      if (
        component !== "page" &&
        component !== "person" &&
        component !== "activity_page"
      ) {
        continue;
      }
      // People without a public page have no URL.
      if (component === "person" && content.page_enabled === false) continue;
      // Respect the editor's "Référencement" choice.
      if (!isIndexable(content.robots)) continue;
      const path = storyPath(story);
      if (!path || seen.indexOf(path) !== -1) continue;
      seen.push(path);
      // Home first, then the main listings, then the rest.
      let priority = "0.6";
      if (path === "/") priority = "1.0";
      else if (
        path === "/equipe" ||
        path === "/activites" ||
        path === "/programme-du-mois"
      ) {
        priority = "0.8";
      }
      const entry: SitemapEntry = {
        loc: origin + normalisePath(path),
        changefreq: path === "/" ? "daily" : "weekly",
        priority: priority,
      };
      if (typeof story.published_at === "string") {
        entry.lastmod = story.published_at.slice(0, 10);
      }
      entries.push(entry);
    }
  } catch {
    // Token missing or API down: serve an empty sitemap, never a 500.
    entries = [];
  }

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries
      .map(
        (e) =>
          "  <url>\n" +
          "    <loc>" +
          e.loc +
          "</loc>\n" +
          (e.lastmod ? "    <lastmod>" + e.lastmod + "</lastmod>\n" : "") +
          "    <changefreq>" +
          e.changefreq +
          "</changefreq>\n" +
          "    <priority>" +
          e.priority +
          "</priority>\n" +
          "  </url>",
      )
      .join("\n") +
    "\n</urlset>\n";

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
