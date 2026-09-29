// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import { storyblok } from '@storyblok/astro';
import { loadEnv } from 'vite';

// IS_PREVIEW=true  -> SSR + Storyblok draft stories (Storyblok visual preview)
// IS_PREVIEW=false -> full static SSG + Storyblok published stories (production)
const env = loadEnv(process.env.NODE_ENV ?? 'production', process.cwd(), '');
const isPreview = (process.env.IS_PREVIEW ?? env.IS_PREVIEW) === 'true';

// https://astro.build/config
export default defineConfig({
  output: isPreview ? 'server' : 'static',
  adapter: vercel(),
  integrations: [
    storyblok({
      accessToken:
        process.env.STORYBLOK_TOKEN ?? env.STORYBLOK_TOKEN ?? 'placeholder-token',
      components: {
        page: 'components/storyblok/Page',
        hero: 'components/storyblok/Hero',
        stats: 'components/storyblok/Stats',
        stat_item: 'components/storyblok/StatItem',
        cards: 'components/storyblok/Cards',
        card: 'components/storyblok/Card',
        membership: 'components/storyblok/Membership',
        activities: 'components/storyblok/Activities',
        activity: 'components/storyblok/Activity',
        concept: 'components/storyblok/Concept',
        gallery: 'components/storyblok/Gallery',
        gallery_image: 'components/storyblok/GalleryImage',
        media_text: 'components/storyblok/MediaText',
        spotlight: 'components/storyblok/Spotlight',
        articles: 'components/storyblok/Articles',
        article_card: 'components/storyblok/ArticleCard',
        testimonials: 'components/storyblok/Testimonials',
        testimonial: 'components/storyblok/Testimonial',
        cta_banner: 'components/storyblok/CtaBanner',
        newsletter: 'components/storyblok/Newsletter',
        faq: 'components/storyblok/Faq',
        faq_item: 'components/storyblok/FaqItem',
        contact: 'components/storyblok/Contact',
        team: 'components/storyblok/Team',
        person: 'components/storyblok/Person',
        activity_page: 'components/storyblok/ActivityPage',
        activity_catalog: 'components/storyblok/ActivityCatalog',
        planning: 'components/storyblok/Planning',
      },
      componentsDir: 'src',
    }),
  ],
});
