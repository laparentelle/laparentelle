interface Multilink {
  cached_url?: string;
  linktype?: string;
  url?: string;
  email?: string;
  target?: string;
}

/** Resolve a Storyblok multilink field to an href string. */
export function resolveLink(link?: Multilink | string | null): string {
  if (!link) return "#";
  if (typeof link === "string") return link;
  if (link.linktype === "email") return `mailto:${link.email ?? link.cached_url}`;
  if (link.url) return link.url;
  const url = link.cached_url ?? "#";
  if (url === "home") return "/";
  return url.startsWith("/") || url.startsWith("http") || url === "#" ? url : `/${url}`;
}

/** Image fields may be a plain URL string (API-written) or an asset object (editor). */
export function imgSrc(image?: string | { filename?: string } | null): string {
  if (!image) return "";
  return typeof image === "string" ? image : (image.filename ?? "");
}

export function imgAlt(
  image?: string | { alt?: string } | null,
  fallback = "",
): string {
  if (!image || typeof image === "string") return fallback;
  return image.alt ?? fallback;
}

/** Split a "one per line" textarea field into a clean string array. */
export function lines(value?: string | null): string[] {
  if (!value) return [];
  return value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}
