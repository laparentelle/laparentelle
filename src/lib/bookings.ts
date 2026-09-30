/**
 * Supabase access for session bookings (server-side only).
 * Uses the PostgREST API directly via fetch — no extra dependency.
 * The service role key must never be exposed to the client.
 */

import { fetchSessionPractitioners, type SessionRecord } from "./sessions";

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
  client_token: string;
  staff_token: string;
  session_snapshot?: BookingSessionSnapshot | null;
  ics_uid?: string | null;
}

export interface BookingSessionSnapshot {
  uid?: string;
  title?: string;
  type?: string;
  start?: string;
  duration?: number;
  capacity?: number;
  location?: string;
  note?: string;
  practitioners?: { name: string; email?: string; url?: string }[];
  recipientEmails?: string[];
}

export type CancellationActor = "client" | "staff" | "admin";

export interface BookingRecord extends Booking {
  id: number;
  status: "confirmed" | "cancelled";
  cancelled_at?: string | null;
  cancelled_by?: CancellationActor | null;
  cancel_reason?: string | null;
  created_at?: string;
}

/** Number of active bookings already made for a session. */
export async function countBookings(sessionUid: string): Promise<number> {
  const url = `${REST("bookings")}?session_uid=eq.${encodeURIComponent(sessionUid)}&status=eq.confirmed&select=id`;
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
  const url = `${REST("bookings")}?session_uid=in.(${list})&status=eq.confirmed&select=session_uid`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  const rows = (await res.json()) as { session_uid: string }[];
  for (const id of sessionUids) out[id] = 0;
  for (const r of rows) {
    if (r.session_uid) out[r.session_uid] = (out[r.session_uid] ?? 0) + 1;
  }
  return out;
}

export interface CreatedBooking {
  client_token: string;
  staff_token: string;
  ics_uid?: string | null;
}

export async function createBooking(booking: Booking): Promise<CreatedBooking> {
  const res = await fetch(`${REST("bookings")}?select=client_token,staff_token,ics_uid`, {
    method: "POST",
    headers: { ...headers(), Prefer: "return=representation" },
    body: JSON.stringify({
      session_uid: booking.session_uid,
      name: booking.name,
      email: booking.email,
      phone: booking.phone ?? null,
      status: "confirmed",
      client_token: booking.client_token,
      staff_token: booking.staff_token,
      session_snapshot: booking.session_snapshot ?? null,
      ics_uid: booking.ics_uid ?? null,
    }),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  const rows = (await res.json()) as {
    client_token?: string;
    staff_token?: string;
    ics_uid?: string | null;
  }[];
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!row?.client_token || !row?.staff_token) {
    throw new Error("Supabase booking was not returned");
  }
  return {
    client_token: row.client_token,
    staff_token: row.staff_token,
    ics_uid: row.ics_uid ?? booking.ics_uid ?? null,
  };
}

const TOKEN_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCancellationToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

function toBookingRecord(row: Record<string, unknown>): BookingRecord {
  return {
    id: Number(row.id),
    session_uid: String(row.session_uid ?? ""),
    name: String(row.name ?? ""),
    email: String(row.email ?? ""),
    phone: (row.phone as string | null) ?? null,
    client_token: String(row.client_token ?? ""),
    staff_token: String(row.staff_token ?? ""),
    session_snapshot: (row.session_snapshot as BookingSessionSnapshot | null) ?? null,
    ics_uid: (row.ics_uid as string | null) ?? null,
    status: row.status === "cancelled" ? "cancelled" : "confirmed",
    cancelled_at: (row.cancelled_at as string | null) ?? null,
    cancelled_by: (row.cancelled_by as CancellationActor | null) ?? null,
    cancel_reason: (row.cancel_reason as string | null) ?? null,
    created_at: String(row.created_at ?? ""),
  };
}

const BOOKING_COLUMNS =
  "id,session_uid,name,email,phone,status,client_token,staff_token,cancelled_at,cancelled_by,cancel_reason,session_snapshot,ics_uid,created_at";

/** Find a booking by either its client or staff cancellation token. */
export async function getBookingByToken(
  token: string,
): Promise<{ booking: BookingRecord; actor: CancellationActor } | null> {
  if (!isCancellationToken(token)) return null;
  const url =
    `${REST("bookings")}?or=(client_token.eq.${token},staff_token.eq.${token})` +
    `&select=${BOOKING_COLUMNS}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  const rows = (await res.json()) as Record<string, unknown>[];
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!row) return null;
  const booking = toBookingRecord(row);
  return {
    booking,
    actor: booking.client_token === token ? "client" : "staff",
  };
}

/**
 * Soft-cancel a booking. The update only applies when the booking is still
 * confirmed, making repeated cancellation requests safe.
 */
export async function cancelConfirmedBooking(
  id: number,
  actor: CancellationActor,
  reason?: string,
): Promise<BookingRecord | null> {
  const res = await fetch(
    `${REST("bookings")}?id=eq.${id}&status=eq.confirmed&select=${BOOKING_COLUMNS}`,
    {
      method: "PATCH",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: actor,
        cancel_reason: reason?.trim() ? reason.trim().slice(0, 500) : null,
      }),
    },
  );
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  const rows = (await res.json()) as Record<string, unknown>[];
  const row = Array.isArray(rows) ? rows[0] : undefined;
  return row ? toBookingRecord(row) : null;
}

export interface SessionRecipient {
  name: string;
  email: string;
  /** Public page of the practitioner, when it is published. */
  url?: string;
}

/**
 * Resolve who should receive a booking request: the e-mails of the
 * `person` stories referenced by the session's `people` field.
 * Returns [] when the session has no linked practitioner.
 */
export async function resolveSessionRecipients(
  session: SessionRecord,
): Promise<SessionRecipient[]> {
  const practitioners = await fetchSessionPractitioners(session);
  return practitioners
    .filter((p) => p.email)
    .map((p) => ({ name: p.name, email: p.email as string, url: p.url }));
}
