/**
 * Supabase access for session bookings (server-side only).
 * Uses the PostgREST API directly via fetch — no extra dependency.
 * The service role key must never be exposed to the client.
 */

import { useStoryblokApi } from "@storyblok/astro";

const REST = (path: string) =>
  `${import.meta.env.SUPABASE_URL}/rest/v1/${path}`;

function key(): string | undefined {
  return import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
}

function headers() {
  return {
    apikey: key() as string,
    Authorization: `Bearer ${key()}`,
    "Content-Type": "application/json",
  };
}

export function isBookingsConfigured(): boolean {
  return Boolean(import.meta.env.SUPABASE_URL && key());
}

export interface Booking {
  session_uid: string;
  name: string;
  email: string;
  phone?: string | null;
}

/** Number of bookings already made for a session. */
export async function countBookings(sessionUid: string): Promise<number> {
  const url = `${REST("bookings")}?session_uid=eq.${encodeURIComponent(sessionUid)}&select=id`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows.length : 0;
}

/** Booked counts for many sessions in one round-trip. */
export async function countBookingsBulk(
  sessionUids: string[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (sessionUids.length === 0) return out;
  const list = sessionUids.map((id) => `"${id.replace(/"/g, '""')}"`).join(",");
  const url = `${REST("bookings")}?session_uid=in.(${list})&select=session_uid`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  const rows = (await res.json()) as { session_uid: string }[];
  for (const id of sessionUids) out[id] = 0;
  for (const r of rows) {
    if (r.session_uid) out[r.session_uid] = (out[r.session_uid] ?? 0) + 1;
  }
  return out;
}

export async function createBooking(booking: Booking): Promise<void> {
  const res = await fetch(REST("bookings"), {
    method: "POST",
    headers: { ...headers(), Prefer: "return=minimal" },
    body: JSON.stringify({
      session_uid: booking.session_uid,
      name: booking.name,
      email: booking.email,
      phone: booking.phone ?? null,
      status: "confirmed",
    }),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
}

export interface SessionRecipient {
  name: string;
  email: string;
}

/**
 * Resolve who should receive a booking request: the e-mails of the
 * `person` stories referenced by the session's `people` field.
 * Returns [] when the session has no linked practitioner.
 */
export async function resolveSessionRecipients(
  sessionUid: string,
): Promise<SessionRecipient[]> {
  const api = useStoryblokApi();
  const version =
    import.meta.env.DEV || import.meta.env.IS_PREVIEW === "true"
      ? "draft"
      : "published";
  const { data } = await api.get("cdn/stories/programme-du-mois", {
    version,
  });
  const sessions = (data?.story?.content?.body?.[0]?.sessions ?? []) as {
    _uid?: string;
    people?: string[];
  }[];
  const session = sessions.find((s) => s._uid === sessionUid);
  const uuids = (session?.people ?? []).filter(Boolean);
  if (!uuids.length) return [];
  const res = await api.get("cdn/stories", {
    version,
    by_uuids: uuids.join(","),
    per_page: 100,
    excluding_fields: "bio,prestations,tarifs,availability,photo",
  });
  return ((res.data?.stories ?? []) as any[])
    .filter((s) => s.content?.email)
    .map((s) => ({ name: s.content.name as string, email: s.content.email as string }));
}
