/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly STORYBLOK_TOKEN: string;
  readonly IS_PREVIEW?: string;
  readonly RESEND_API_KEY: string;
  readonly CONTACT_TO_EMAIL: string;
  readonly CONTACT_FROM_EMAIL?: string;
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
}
