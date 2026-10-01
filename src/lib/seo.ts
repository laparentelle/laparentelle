/**
 * SEO helpers: canonical URLs, robots directives, social meta and
 * schema.org JSON-LD builders.
 *
 * The canonical origin resolves in this order:
 *   1. PUBLIC_SITE_URL (set in `.env` / Vercel — the production origin)
 *   2. `site` in astro.config.mjs
 *   3. the request origin (dev fallback)
 */

export interface SchemaNode {
  [key: string]: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/* ------------------------------------------------------------------ URLs -- */

/** Absolute, slash-free origin (never ends with `/`). */
export function siteOrigin(requestUrl: URL, site?: URL): string {
  const configured = String(import.meta.env.PUBLIC_SITE_URL || "").trim();
  const raw = configured || (site ? site.href : "") || requestUrl.origin;
  return raw.replace(/\/+$/, "");
}

/** Site-relative path to absolute URL. External URLs pass through. */
export function absoluteUrl(origin: string, path: string | null | undefined): string {
  if (!path) return origin;
  if (/^(https?:)?\/\//i.test(path)) return path;
  if (path.indexOf("mailto:") === 0) return path;
  const clean = path.charAt(0) === "/" ? path : "/" + path;
  return origin + clean;
}

/** Canonical path form: single leading slash, no query/hash/trailing slash. */
export function normalisePath(pathname: string): string {
  const noQuery = pathname.split(/[?#]/)[0];
  const single = noQuery.replace(/\/{2,}/g, "/");
  if (single === "" || single === "/") return "/";
  return single.replace(/\/+$/, "");
}

/* --------------------------------------------------------------- robots -- */

export const DEFAULT_ROBOTS = "index, follow";

const ROBOT_TOKENS = [
  "index",
  "noindex",
  "follow",
  "nofollow",
  "noarchive",
  "nosnippet",
  "noimageindex",
  "max-snippet:-1",
];

/**
 * Editor `robots` option -> meta content.
 * Route-level `noindex` (preview-only pages) always wins.
 */
export function robotsContent(editorValue: unknown, noindex: boolean): string {
  if (noindex) return "noindex, nofollow";
  const raw = typeof editorValue === "string" ? editorValue.trim().toLowerCase() : "";
  if (!raw) return DEFAULT_ROBOTS;
  const kept: string[] = [];
  const parts = raw.split(",");
  for (let i = 0; i < parts.length; i++) {
    const t = parts[i].trim();
    if (ROBOT_TOKENS.indexOf(t) !== -1 && kept.indexOf(t) === -1) kept.push(t);
  }
  return kept.length > 0 ? kept.join(", ") : DEFAULT_ROBOTS;
}

/** True unless the editor's robots value contains `noindex`. */
export function isIndexable(editorValue: unknown): boolean {
  return robotsContent(editorValue, false).indexOf("noindex") === -1;
}

/* ------------------------------------------------------------- JSON-LD -- */

/** Serialise to JSON-LD, neutralising any `</script>` break-out. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).split("<").join("\\u003c");
}

/**
 * Parse the editor's manual schema field. Accepts one object, an array, or a
 * `@graph` wrapper. Returns [] when empty or invalid, so a typo can never
 * take a page down.
 */
export function parseManualSchema(value: unknown): SchemaNode[] {
  if (typeof value !== "string") return [];
  const raw = value.trim();
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) {
    const out: SchemaNode[] = [];
    for (const n of parsed) if (isRecord(n)) out.push(n);
    return out;
  }
  if (isRecord(parsed)) {
    const graph = parsed["@graph"];
    if (Array.isArray(graph)) {
      const out: SchemaNode[] = [];
      for (const n of graph) if (isRecord(n)) out.push(n);
      return out;
    }
    return [parsed];
  }
  return [];
}

/* ------------------------------------------------------------- builders -- */
export interface SiteInfo {  origin: string;
  siteName: string;
  locale: string;
  logo?: string;
  ogImage?: string;
  address?: string;
  phone?: string;
  email?: string;
  tagline?: string;
  sameAs?: string[];
  geoLat?: number;
  geoLon?: number;
}

export function cleanText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Storyblok richtext (JSON) or HTML string -> plain text. Used for schema
 * `text` fields, which must not contain markup.
 */
export function richtextToText(node: unknown): string {
  if (typeof node === "string") {
    return node.replace(/<[^>]+>/g, " ");
  }
  if (!isRecord(node)) return "";
  if (typeof node.text === "string") return node.text;
  const content = node.content;
  if (!Array.isArray(content)) return "";
  const out: string[] = [];
  for (const child of content) {
    const t = richtextToText(child);
    if (t) out.push(t);
  }
  const kind = typeof node.type === "string" ? node.type : "";
  const block = kind === "paragraph" || kind === "heading" || kind === "list_item" || kind === "blockquote" || kind === "doc";
  return out.join(block ? "\n" : " ");
}

export function squashWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export interface GlobalContent {
  [key: string]: unknown;
}

function assetFilename(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (isRecord(v) && typeof v.filename === "string") return v.filename.trim();
  return "";
}

function textLines(v: unknown): string[] {
  if (typeof v !== "string") return [];
  const out: string[] = [];
  const rows = v.split("\n");
  for (const r of rows) {
    const t = r.trim();
    if (t) out.push(t);
  }
  return out;
}

/**
 * Build the site identity for schema builders from the `global` story
 * content. Tolerates a missing story (falls back to bare origin + name).
 */
export function siteInfoFromGlobal(
  origin: string,
  content: GlobalContent | null | undefined,
  siteName: string,
): SiteInfo {
  const c: GlobalContent = content || {};
  const text = (k: string): string => {
    const v = c[k];
    return typeof v === "string" ? v.trim() : "";
  };
  const logo = assetFilename(c.logo);
  const og = assetFilename(c.og_image);
  const info: SiteInfo = {
    origin: origin,
    siteName: text("site_name") || siteName,
    locale: "fr_FR",
  };
  if (logo) info.logo = absoluteUrl(origin, logo);
  const share = og || logo;
  if (share) info.ogImage = absoluteUrl(origin, share);
  const address = text("footer_address");
  if (address) info.address = address;
  const phone = text("footer_phone");
  if (phone) info.phone = phone;
  const email = text("footer_email");
  if (email) info.email = email;
  const tagline = text("footer_tagline");
  if (tagline) info.tagline = tagline;
  const same: string[] = [];
  for (const u of textLines(c.same_as)) {
    if (/^https?:\/\//i.test(u)) same.push(u);
  }
  if (same.length > 0) info.sameAs = same;
  const geo = geoFrom(c.geo_latitude, c.geo_longitude);
  if (geo) {
    info.geoLat = geo.lat;
    info.geoLon = geo.lon;
  }
  return info;
}

function numOrUndefined(v: unknown): number | undefined {
  const s = typeof v === "string" ? v.trim().replace(",", ".") : v;
  const n = typeof s === "number" ? s : Number(s);
  if (!isFinite(n) || n === 0) return undefined;
  return n;
}

export function geoFrom(lat: unknown, lon: unknown): { lat: number; lon: number } | undefined {
  const a = numOrUndefined(lat);
  const b = numOrUndefined(lon);
  if (a === undefined || b === undefined) return undefined;
  return { lat: a, lon: b };
}

/**
 * The site as one entity. `LocalBusiness` when we know the address,
 * plain `Organization` otherwise.
 */
export function organizationSchema(site: SiteInfo): SchemaNode {
  const node: SchemaNode = {
    "@type": site.address ? "LocalBusiness" : "Organization",
    "@id": site.origin + "/#organization",
    name: site.siteName,
    url: site.origin + "/",
  };
  if (site.tagline) node.description = site.tagline;
  if (site.logo) {
    node.logo = { "@type": "ImageObject", url: site.logo };
    node.image = site.ogImage || site.logo;
  } else if (site.ogImage) {
    node.image = site.ogImage;
  }
  if (site.address) {
    node.address = { "@type": "PostalAddress", streetAddress: site.address };
  }
  if (site.phone) node.telephone = site.phone;
  if (site.email) node.email = site.email;
  if (site.sameAs && site.sameAs.length > 0) node.sameAs = site.sameAs;
  if (site.geoLat !== undefined && site.geoLon !== undefined) {
    node.geo = {
      "@type": "GeoCoordinates",
      latitude: site.geoLat,
      longitude: site.geoLon,
    };
  }
  return node;
}

export function websiteSchema(site: SiteInfo): SchemaNode {
  return {
    "@type": "WebSite",
    "@id": site.origin + "/#website",
    url: site.origin + "/",
    name: site.siteName,
    inLanguage: site.locale,
    publisher: { "@id": site.origin + "/#organization" },
  };
}

export interface Crumb {
  name: string;
  href: string;
}

export function breadcrumbSchema(origin: string, trail: Crumb[]): SchemaNode | null {
  const items: Crumb[] = [];
  for (const t of trail) if (t && t.name) items.push(t);
  if (items.length < 2) return null;
  const list: SchemaNode[] = [];
  for (let i = 0; i < items.length; i++) {
    list.push({
      "@type": "ListItem",
      position: i + 1,
      name: items[i].name,
      item: absoluteUrl(origin, items[i].href),
    });
  }
  return { "@type": "BreadcrumbList", itemListElement: list };
}

export interface FaqItem {
  question?: string;
  answer?: string;
}

export function faqPageSchema(items: FaqItem[]): SchemaNode | null {
  const entities: SchemaNode[] = [];
  for (const it of items) {
    const q = cleanText(it.question);
    const a = cleanText(it.answer);
    if (!q || !a) continue;
    entities.push({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    });
  }
  if (entities.length === 0) return null;
  return { "@type": "FAQPage", mainEntity: entities };
}

export interface EventPerformer {
  name: string;
  url?: string;
}

export interface EventInput {
  title: string;
  start: Date;
  minutes: number;
  url: string;
  description?: string;
  capacity?: number;
  performers?: EventPerformer[];
  placeName?: string;
  placeAddress?: string;
}

/** A bookable slot as schema.org Event. */
export function eventSchema(site: SiteInfo, ev: EventInput): SchemaNode {
  const end = new Date(ev.start.getTime() + ev.minutes * 60000);
  const node: SchemaNode = {
    "@type": "Event",
    name: ev.title,
    startDate: ev.start.toISOString(),
    endDate: end.toISOString(),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    url: ev.url,
    inLanguage: site.locale,
  };
  if (ev.description) node.description = ev.description;
  const address = ev.placeAddress || site.address;
  const loc: SchemaNode = {
    "@type": "Place",
    name: ev.placeName || site.siteName,
  };
  if (address) loc.address = { "@type": "PostalAddress", streetAddress: address };
  node.location = loc;
  // The full Organization lives in the head @graph; reference it by id.
  node.organizer = { "@id": site.origin + "/#organization" };
  if (ev.performers && ev.performers.length > 0) {
    const cast: SchemaNode[] = [];
    for (const p of ev.performers) {
      const person: SchemaNode = { "@type": "Person", name: p.name };
      if (p.url) person.url = absoluteUrl(site.origin, p.url);
      cast.push(person);
    }
    node.performer = cast;
  }
  if (ev.capacity && ev.capacity > 0) {
    const offer: SchemaNode = {
      "@type": "Offer",
      availability: "https://schema.org/InStock",
    };
    if (ev.capacity > 1) {
      offer.eligibleQuantity = { "@type": "QuantitativeValue", maxValue: ev.capacity };
    }
    node.offers = offer;
  }
  return node;
}

export interface PersonInput {
  name: string;
  url?: string;
  jobTitle?: string;
  image?: string;
  email?: string;
  phone?: string;
  knowsAbout?: string[];
}

export function personSchema(site: SiteInfo, person: PersonInput): SchemaNode {
  const pageUrl = person.url ? absoluteUrl(site.origin, person.url) : site.origin + "/";
  const node: SchemaNode = {
    "@type": "Person",
    "@id": pageUrl + "#person",
    name: person.name,
    url: pageUrl,
    worksFor: { "@id": site.origin + "/#organization" },
  };
  if (person.jobTitle) node.jobTitle = person.jobTitle;
  if (person.image) node.image = person.image;
  if (person.email) node.email = person.email;
  if (person.phone) node.telephone = person.phone;
  if (person.knowsAbout && person.knowsAbout.length > 0) {
    node.knowsAbout = person.knowsAbout;
  }
  return node;
}

/* -------------------------------------------------- content-type mapping -- */

export interface SeoFields {
  robots?: unknown;
  seo_image?: unknown;
  og_type?: unknown;
  canonical_url?: unknown;
  schema_manual?: unknown;
}

export interface SeoProps {
  robots: unknown;
  image: string | undefined;
  ogType: "website" | "article";
  canonical: string | undefined;
  schema: SchemaNode[];
}

/**
 * Map the SEO fields of `page` / `person` / `activity_page` stories to
 * BaseLayout props. Everything optional — missing means site-wide defaults.
 */
export function seoPropsFrom(content: SeoFields | null | undefined): SeoProps {
  const c: SeoFields = content || {};
  let image: string | undefined;
  const raw = c.seo_image;
  if (typeof raw === "string" && raw) {
    image = raw;
  } else if (isRecord(raw)) {
    const f = raw.filename;
    if (typeof f === "string" && f) image = f;
  }
  let canonical: string | undefined;
  if (typeof c.canonical_url === "string" && c.canonical_url.trim()) {
    canonical = c.canonical_url.trim();
  }
  return {
    robots: c.robots,
    image: image,
    ogType: c.og_type === "article" ? "article" : "website",
    canonical: canonical,
    schema: parseManualSchema(c.schema_manual),
  };
}
