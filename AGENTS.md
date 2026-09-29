# AGENTS.md

Astro 7 scaffold present (`src/`, `astro.config.mjs`). Deploy: Vercel (`@astrojs/vercel`). Commands: `npm run dev`, `npm run build` (production), `npm run build:preview` (Storyblok preview).

## Deploy / rendering modes (`IS_PREVIEW`)

- `IS_PREVIEW=false` → `output: 'static'`, full SSG, Storyblok **published** stories (production).
- `IS_PREVIEW=true` → `output: 'server'`, SSR, Storyblok **draft** stories (Storyblok visual preview).
- Story version logic lives in `src/lib/storyblok.ts` (draft when `DEV` or `IS_PREVIEW=true`).
- Real env vars take precedence over `.env` file — on Vercel set `IS_PREVIEW=true` on the preview project/domain.

## Stack / conventions

- Astro only. Vanilla HTML/CSS/JS in `.astro` components. Do not add a UI framework.
- Vanilla CSS co-located with components; vanilla JS scoped to the component that needs it.
- GSAP (ScrollTrigger, parallax) only when an animation need exists — not preemptively. All `src/lib` modules are `.ts` — a TS generic in a `.js` file (e.g. `toArray<HTMLElement>(…)`) silently parses as a comparison and breaks at runtime.
- Forms + email automations go through Resend.

## Design system (`src/styles/design-system.css`)

- Gaia-inspired, eucalyptus-green primary (`--c-pine: #2e5249`) — never terracotta. Warm ivory bg, gold accents kept. Contrast accent: marigold (`--c-marigold: #e9a13b`) for low-contrast spots (e.g. hero primary) and buttons needing a visible hover change (e.g. activity booking).
- Fonts: Sentient (display, via Fontshare) + Jost (body) + La Belle Aurore (handwritten accents: card subtitles, testimonial signatures via `.font-hand`) via Google Fonts in `BaseLayout`.
- Primitives: `Button.astro` (`button-027` motion: primary/light/outline-light/ghost, `small`, `submit`), `.btn-row`, `.eyebrow`, `.badge`, `.blok-section`, `--radius-card`. Section components use legacy aliases (`--bg`, `--ink`, `--muted`, `--accent`, `--line`).
- Neumorphism vibe: surfaces use `--neu-surface` + dual soft shadows (`--shadow-neu`/`-sm`/`-lg`, `--shadow-neu-inset` for pressed states/inputs), no borders. Brand buttons stay solid colored (never neumorphic).
- Feature images (media_text, spotlight, person, gallery) use `.frame-organic`: 4 blob `--frame-radius` personalities (`--b/c/d` modifiers), flat with no keyline; reversed splits take B, galleries auto-cycle all 4 via `:nth-child` so neighbors differ. Card thumbnails stay plain rounded.

## Storyblok

- Content-type `page` = SEO fields + `body` (blocks) field.
- Pages render by iterating `body` blocks; one Astro/Storyblok component per block.
- Section bloks (from lamaisongaia.fr homepage, nav/top-banner skipped): `hero`, `stats`+`stat_item`, `cards`+`card`, `membership`, `activities`+`activity`, `concept`, `gallery`+`gallery_image`, `media_text`, `spotlight`, `articles`+`article_card`, `testimonials`+`testimonial`, `cta_banner`, `newsletter`. All registered in `astro.config.mjs`.
- Richtext fields render via `renderRichText` from `@storyblok/astro`; multilink/textarea-list helpers in `src/lib/links.ts`.
- `[...slug].astro` (`prerender: false`) renders any story; `person` stories get story tags passed explicitly (`story.tag_list` is not part of `content`).
- Team model: `equipe/` folder holds `person` stories (name/role/photo/email/phone/booking/availability/bio/prestations/tarifs) + the `Notre équipe` listing page, which Storyblok pins to the folder slug → served at `/equipe`. Persons carry pole tags (`Maternité`, `Féminité`, `Parentalité`, `Bouger son corps`); the `team` blok fetches them live (`starts_with=equipe/`, filters non-person stories) with client-side tag filtering. Person flags (both default true when unset): `visible_in_list=false` hides from listing + contact dropdown, `page_enabled=false` 404s the detail page.
- Session → practitioner link: `session.people` is a References field (`options` + `is_reference_type`, restricted to `person` in `equipe/` — the API rejects a bare `reference` type) storing person UUIDs; `/api/book` resolves them via `by_uuids` and mails the booking there, admin fallback otherwise.
- Activities model (same pattern): `activites/` folder holds `activity_page` stories (title/image/animator/schedule/price/email/phone/booking/description) + listing page; `activity_catalog` blok fetches live with `Toutes/Sport/Ateliers` tag filtering (`Sport` vs `Atelier` story tags). Detail template `ActivityPage` also receives `story.tag_list` via the route.
- Contact form (`ContactForm.astro` + `src/lib/contacts.ts`): fields Nom/Prénom/Email/Message/Destinataire. General mode builds the recipient dropdown live from `equipe/` emails (`Administratif` = `CONTACT_TO_EMAIL` first); fixed mode (`fixedEmail`, used on person pages + `contact` blok `person` mode) hides the dropdown. Person pages without an email fall back to the admin address. `/api/contact` only delivers to allowlisted addresses — never trust client input.
- Planning (`/programme-du-mois`): one `planning` story holds a `session` bloks field (blocks-over-stories, so **the `session` blok `_uid` is the booking key** — never hand-write one; moving a session keeps its uid, deleting/re-creating orphans its bookings). Session `type` (not `kind`): `activite` | `sport` | `bienetre` | `consultation`, driving the filter chips, badges and slot colours. Component filters to the next 30 days, shown 4 days at a time with prev/next nav (empty days stay visible; grid on desktop ≥64rem, day cards on mobile). Remaining spots = `capacity` − Supabase count; without `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` the page degrades to a phone/contact note instead of booking buttons.
- Bookings: `src/lib/bookings.ts` (PostgREST via fetch, server-only service key) + `/api/book` (capacity check → insert → Resend confirmation, honeypot, no cancellation flow). Table DDL in `supabase/migrations/001_bookings.sql`.
- Storyblok `datetime` fields only render in the editor when the value is **UTC ISO with Z** (`2026-09-28T16:30:00.000Z`). `+02:00` offsets and `YYYY-MM-DD HH:MM:SS` are stored but show as empty. Always write Paris times converted to UTC (`src/lib/date.ts` parses both safely). Storage is always UTC; the "UTC+00:00" chip in the field is the *user* timezone (`PUT /v1/users/me {user:{timezone}}`, set to `Europe/Paris`) and only affects display/entry.
- Storyblok `number` fields reject JSON ints: the API wants a **string of digits** (`"60"`, not `60`) — sending an int returns 422 "must be a string with numbers". Session `duration` is a `number` field holding minutes, sent as `"60"`.
- After editing `astro.config.mjs`, restart the dev server (`npx astro dev stop` + `npm run dev`) — component registration is not hot-reloaded.

## Project

- Site for "La Parent'elle" — un lieu pluridisciplinaire pour la femme et la famille.
- Design inspiration: https://www.lamaisongaia.fr/

## Gotchas (verified during setup)

- `@storyblok/astro` has no default export: `import { storyblok } from '@storyblok/astro'`, and `StoryblokComponent` is a separate path: `import StoryblokComponent from '@storyblok/astro/StoryblokComponent.astro'`.
- `components` map paths are relative to `componentsDir: 'src'` — e.g. `page: 'components/storyblok/Page'`.
- `@astrojs/vercel` adapter. Contact form needs `RESEND_API_KEY` + `CONTACT_TO_EMAIL` (see `.env.example`).
- Env: copy `.env.example` to `.env`. Without a real `STORYBLOK_TOKEN`, `/` renders a static placeholder (by design).
