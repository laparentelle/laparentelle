import { useStoryblokApi } from "@storyblok/astro";

export interface Recipient {
  name: string;
  email: string;
}

const FALLBACK_ADMIN_EMAIL = "laparentelle.contact@gmail.com";

export function adminEmail(): string {
  return import.meta.env.CONTACT_TO_EMAIL || FALLBACK_ADMIN_EMAIL;
}

/**
 * Server-side only. Builds the recipient allowlist: Administratif first,
 * then every person in equipe/ that has an email. Used both to render the
 * dropdown and to validate submissions (never trust client input).
 */
export async function getContactRecipients(): Promise<Recipient[]> {
  const admin = adminEmail();
  const list: Recipient[] = [{ name: "Administratif", email: admin }];
  try {
    const api = useStoryblokApi();
    const version =
      import.meta.env.DEV || import.meta.env.IS_PREVIEW === "true"
        ? "draft"
        : "published";
    const { data } = await api.get("cdn/stories", {
      version,
      starts_with: "equipe/",
      per_page: 100,
      excluding_fields: "bio,prestations,tarifs,availability,phone,photo,role",
    });
    const people = ((data?.stories ?? []) as any[])
      .filter(
        (s) =>
          s.content?.component === "person" &&
          s.content?.email &&
          s.content?.page_enabled !== false,
      )
      .map((s) => ({ name: s.content.name as string, email: s.content.email as string }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
    for (const p of people) {
      if (p.email !== admin) list.push(p);
    }
  } catch {
    // Fall through with Administratif only.
  }
  return list;
}
