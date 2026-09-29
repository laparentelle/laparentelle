# La Parent'elle

Website for **La Parent'elle** — *un lieu pluridisciplinaire pour la femme et la famille*.

Design inspiration: https://www.lamaisongaia.fr/

## Stack

- **Astro** — framework. Always prefer vanilla HTML / CSS / JS in vanilla Astro components (`.astro`). No UI framework by default.
- **Storyblok** — headless CMS.
- **Resend** — contact forms and email automations.
- **GSAP** — only if animation is needed (ScrollTrigger, parallax, etc.).

## Conventions

- Prefer vanilla Astro components over framework components.
- Keep styling in vanilla CSS alongside components unless a shared pattern emerges.
- Keep JS vanilla and scoped to the component that needs it.
- Only add GSAP when a real animation need exists; don't add it preemptively.

## Storyblok model

- Content-type `page`:
  - SEO fields
  - `body` field (blocks type) containing all components used to build the page.

All pages are built by rendering the blocks from `body`.

## Forms & email

- Contact forms and email automations go through **Resend**.

## Getting started

```sh
npm install
cp .env.example .env  # then fill in STORYBLOK_TOKEN, RESEND_API_KEY, CONTACT_TO_EMAIL
npm run dev
```
