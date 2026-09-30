import { useStoryblokApi } from "@storyblok/astro";

function storyVersion(): "draft" | "published" {
  // Draft in dev and in preview builds (IS_PREVIEW=true), published in production.
  return import.meta.env.DEV || import.meta.env.IS_PREVIEW === "true"
    ? "draft"
    : "published";
}

export async function getPageStory(slug: string) {
  const storyblokApi = useStoryblokApi();
  const { data } = await storyblokApi.get(`cdn/stories/${slug}`, {
    version: storyVersion(),
  });
  return data?.story ?? null;
}

/**
 * Site-wide settings (`global` story). Never throws: pages fall back to
 * hardcoded defaults when the story is missing (e.g. placeholder token).
 */
export async function getGlobalStory() {
  try {
    const storyblokApi = useStoryblokApi();
    const { data } = await storyblokApi.get("cdn/stories/global", {
      version: storyVersion(),
    });
    return data?.story ?? null;
  } catch {
    return null;
  }
}
