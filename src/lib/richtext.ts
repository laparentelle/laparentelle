import { renderRichText } from "@storyblok/astro";
import { normaliseInternalHrefs } from "./links";

/**
 * `renderRichText` plus the site URL convention: internal links never keep a
 * trailing slash (Storyblok emits `/equipe/` for folder-index pages).
 */
export function richText(value: unknown): string {
  if (!value) return "";
  return normaliseInternalHrefs(renderRichText(value as any));
}
