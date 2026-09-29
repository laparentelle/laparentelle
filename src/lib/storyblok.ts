import { useStoryblokApi } from "@storyblok/astro";

export async function getPageStory(slug: string) {
  const storyblokApi = useStoryblokApi();
  // Draft in dev and in preview builds (IS_PREVIEW=true), published in production.
  const version =
    import.meta.env.DEV || import.meta.env.IS_PREVIEW === "true"
      ? "draft"
      : "published";
  const { data } = await storyblokApi.get(`cdn/stories/${slug}`, {
    version,
  });
  return data?.story ?? null;
}
