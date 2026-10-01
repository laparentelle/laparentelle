// @ts-check
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import { storyblok } from '@storyblok/astro';
import { loadEnv } from 'vite';

// IS_PREVIEW=true  -> SSR + Storyblok draft stories (Storyblok visual preview)
// IS_PREVIEW=false -> full static SSG + Storyblok published stories (production)
const env = loadEnv(process.env.NODE_ENV ?? 'production', process.cwd(), '');
const isPreview = (process.env.IS_PREVIEW ?? env.IS_PREVIEW) === 'true';

// Canonical/OG/sitemap URLs fall back to the request host when this is unset.
// That is fine for preview, but production would ship localhost canonicals.
if (!isPreview && !(process.env.PUBLIC_SITE_URL ?? env.PUBLIC_SITE_URL)) {
  console.warn(
    '\n[seo] PUBLIC_SITE_URL is not set: canonical, og:url and sitemap URLs ' +
      'will use the request host. Set it to the production domain.\n',
  );
}

// The editor guide (/guide) renders only in preview builds, but Astro still
// emits its screenshots because the component is statically imported. Strip
// them from production output so internal documentation is never deployed.
const GUIDE_ASSETS = [
  'planning', 'apercu-seance', 'dialogue-reservation', 'dialogue-externe',
  'accueil-activites', 'equipe', 'personne', 'personne-reserver',
  'activite-page', 'activites-catalogue', 'activites-filtre-sport', 'contact',
  'mobile-planning', 'mobile-equipe', 'accueil-hero', 'schema-contenu',
  'flux-reservation',
];

const dropGuideAssets = () => ({
  name: 'drop-guide-assets',
  hooks: {
    'astro:build:done': ({ dir }) => {
      const assets = join(dir.pathname, '_astro');
      let dropped = 0;
      for (const file of readdirSync(assets)) {
        const base = file.replace(/\.[A-Za-z0-9_-]{8,}\.\w+$/, '');
        if (GUIDE_ASSETS.includes(base)) {
          rmSync(join(assets, file));
          dropped += 1;
        }
      }
      console.log(`[drop-guide-assets] removed ${dropped} editor screenshots`);
    },
  },
});

// https://astro.build/config
export default defineConfig({
  // Canonical origin for absolute URLs (canonical, og:url, sitemap).
  // Set PUBLIC_SITE_URL in `.env` / Vercel to the production domain.
  site: process.env.PUBLIC_SITE_URL ?? env.PUBLIC_SITE_URL,
  output: isPreview ? 'server' : 'static',
  adapter: vercel(),
  integrations: [
    ...(isPreview ? [] : [dropGuideAssets()]),
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
