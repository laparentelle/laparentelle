/**
 * Session + practitioner lookups for the planning.
 *
 * Uses the plain Storyblok REST API (token + space id) instead of
 * `useStoryblokApi()`, because these lookups also run inside the
 * `/api/book` route handler, outside of any Astro component context.
 */

import { resolveLink } from "./links";

const PLANNING_SLUG = "programme-du-mois";
const SESSIONS_FOLDER = "seances/";
const TZ = "Europe/Paris";

/** Draft in dev and in preview builds (IS_PREVIEW=true), published in production. */
export function storyVersion(): "draft" | "published" {
  return import.meta.env.DEV || import.meta.env.IS_PREVIEW === "true"
    ? "draft"
    : "published";
}

function credentials(): { space: string; token: string } | null {
  const space = import.meta.env.STORYBLOK_SPACE_ID;
  const token = import.meta.env.STORYBLOK_TOKEN;
  if (!space || !token || token === "placeholder-token") return null;
  return { space, token };
}

async function cdnGet<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  const creds = credentials();
  if (!creds) return null;
  const url = new URL(`https://api.storyblok.com/v2/cdn/${path}`);
  url.searchParams.set("token", creds.token);
  url.searchParams.set("version", storyVersion());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Storyblok ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    console.error(`storyblok request failed (${path})`, err);
    return null;
  }
}

export interface SessionRecord {
  /** Session story UUID — the booking key (stable across edits). */
  uid: string;
  slug: string;
  title: string;
  type?: string;
  start?: string;
  duration?: number;
  capacity?: number;
  note?: string;
  /** `people` story-reference field: person UUIDs. */
  people: string[];
  external_booking: boolean;
  /** `activity` story-reference field: linked `activity_page` story UUID. */
  activity?: string;
}

export interface Practitioner {
  uuid: string;
  name: string;
  email?: string;
  /** Public page of the person, e.g. `/equipe/laura-gleizes`. */
  url?: string;
  /** Direct booking target from the person's `booking_link` field
   * (Doctolib & co.), falling back to `url` when unset. */
  bookingUrl?: string;
}

const toMinutes = (value?: string | number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 60;
};

/** Storyblok checkboxes arrive as booleans; be lenient with raw values. */
const toExternalBooking = (value: unknown): boolean =>
  value === true || value === "true" || value === 1;

const toCapacity = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

const toStoryRef = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;

function toSessionRecord(story: Record<string, any>): SessionRecord | null {
  const content = (story.content ?? {}) as Record<string, unknown>;
  if (!story.uuid) return null;
  return {
    uid: story.uuid as string,
    slug: (story.full_slug as string) ?? "",
    title: (content.title as string) ?? "Séance",
    type: content.type as string | undefined,
    start: content.start as string | undefined,
    duration: toMinutes(content.duration as string | number | undefined),
    capacity: toCapacity(content.capacity),
    note: content.note as string | undefined,
    people: Array.isArray(content.people)
      ? (content.people as string[]).filter(Boolean)
      : [],
    external_booking: toExternalBooking(content.external_booking),
    activity: toStoryRef(content.activity),
  };
}

/** Session story UUIDs referenced by the planning story, in editorial order. */
async function fetchPlanningSessionUuids(): Promise<string[]> {
  const data = await cdnGet<{ story: { content: { body?: unknown[] } } }>(
    `stories/${PLANNING_SLUG}`,
  );
  const body = data?.story?.content?.body;
  const planning = Array.isArray(body)
    ? (body.find((b) => (b as { component?: string })?.component === "planning") as
        | { sessions?: unknown[] }
        | undefined)
    : undefined;
  const refs = planning?.sessions ?? [];
  return (Array.isArray(refs) ? refs : []).filter(
    (r): r is string => typeof r === "string" && Boolean(r),
  );
}

async function fetchSessionStoriesByUuids(uuids: string[]): Promise<SessionRecord[]> {
  const unique = [...new Set(uuids.filter(Boolean))];
  if (!unique.length) return [];
  const data = await cdnGet<{ stories: Record<string, any>[] }>("stories", {
    by_uuids: unique.join(","),
    per_page: "100",
  });
  const byUuid = new Map<string, SessionRecord>();
  for (const story of data?.stories ?? []) {
    const record = toSessionRecord(story);
    if (record) byUuid.set(record.uid, record);
  }
  // by_uuids order is not guaranteed: restore the requested order.
  return unique
    .map((uuid) => byUuid.get(uuid))
    .filter((s): s is SessionRecord => Boolean(s));
}

/** Session stories by UUIDs, in the requested order (missing UUIDs skipped). */
export async function fetchSessionsByUuids(uuids: string[]): Promise<SessionRecord[]> {
  return fetchSessionStoriesByUuids(uuids);
}

/** Every session of the planning story, in Storyblok order. */
export async function fetchPlanningSessions(): Promise<SessionRecord[]> {
  return fetchSessionStoriesByUuids(await fetchPlanningSessionUuids());
}

/** One session by its story UUID (the booking key). */
export async function fetchSession(uid: string): Promise<SessionRecord | null> {
  const sessions = await fetchSessionStoriesByUuids([uid]);
  return sessions[0] ?? null;
}

/** All `session` stories (paginated), newest-folder order is not guaranteed. */
export async function fetchAllSessionStories(): Promise<SessionRecord[]> {
  const out: SessionRecord[] = [];
  let page = 1;
  for (;;) {
    const data = await cdnGet<{ stories: Record<string, any>[] }>("stories", {
      starts_with: SESSIONS_FOLDER,
      per_page: "100",
      page: String(page),
    });
    const stories = data?.stories ?? [];
    if (!stories.length) break;
    for (const story of stories) {
      if ((story.content as Record<string, unknown> | undefined)?.component !== "session")
        continue;
      const record = toSessionRecord(story);
      if (record) out.push(record);
    }
    if (stories.length < 100) break;
    page += 1;
  }
  return out;
}

/** Upcoming sessions linked to an `activity_page` story, soonest first. */
export async function fetchSessionsByActivity(
  activityUuid: string,
  from: Date = new Date(),
): Promise<SessionRecord[]> {
  if (!activityUuid) return [];
  // Server-side filter first: avoids pulling the whole folder per card.
  let stories: Record<string, any>[] = [];
  try {
    const data = await cdnGet<{ stories: Record<string, any>[] }>("stories", {
      starts_with: SESSIONS_FOLDER,
      per_page: "100",
      "filter_query[activity][is]": activityUuid,
    });
    stories = data?.stories ?? [];
  } catch {
    stories = [];
  }
  const out: SessionRecord[] = [];
  for (const story of stories) {
    if ((story.content as Record<string, unknown> | undefined)?.component !== "session")
      continue;
    const record = toSessionRecord(story);
    if (!record || record.activity !== activityUuid || !record.start) continue;
    const d = new Date(record.start);
    if (Number.isNaN(d.getTime()) || d.getTime() < from.getTime()) continue;
    out.push(record);
  }
  return out.sort((a, b) => (a.start as string).localeCompare(b.start as string));
}

/** Resolve person UUIDs to their name / email / public page. */
export async function fetchPractitioners(
  uuids: string[],
): Promise<Map<string, Practitioner>> {
  const out = new Map<string, Practitioner>();
  const unique = [...new Set(uuids.filter(Boolean))];
  if (!unique.length) return out;

  const data = await cdnGet<{ stories: Record<string, any>[] }>("stories", {
    by_uuids: unique.join(","),
    per_page: "100",
    excluding_fields: "bio,prestations,tarifs,availability,photo",
  });
  for (const story of data?.stories ?? []) {
    const uuid = story.uuid as string | undefined;
    if (!uuid) continue;
    const bookingHref = resolveLink(story.content?.booking_link ?? null);
    out.set(uuid, {
      uuid,
      name: (story.content?.name as string) ?? (story.name as string) ?? "",
      email: story.content?.email as string | undefined,
      url: (story.content?.page_enabled !== false && story.full_slug
        ? `/${story.full_slug}`
        : undefined),
      bookingUrl: bookingHref === "#" ? undefined : bookingHref,
    });
  }
  return out;
}

export async function fetchSessionPractitioners(
  session: SessionRecord,
): Promise<Practitioner[]> {
  const map = await fetchPractitioners(session.people);
  return session.people.map((uuid) => map.get(uuid)).filter((p): p is Practitioner => Boolean(p));
}

// ---- presentation helpers (Paris time) ----

const dt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, ...opts });

const dateFmt = dt({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
const dayShortFmt = dt({ weekday: "long", day: "numeric", month: "long" });
const timeFmt = dt({ hour: "2-digit", minute: "2-digit" });

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} h ${String(m).padStart(2, "0")}`;
  if (h) return `${h} h`;
  return `${m} min`;
}

export interface SessionTiming {
  date?: string;
  range?: string;
  duration?: string;
}

/** Calendar day (`AAAA-MM-JJ`, Paris time) of a session start — used for
 * deep links into the planning (`/programme-du-mois?date=…`). */
export function sessionDayKey(start: string | undefined): string | undefined {
  if (!start) return undefined;
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

export function sessionTiming(
  start: string | undefined,
  minutes: number,
  opts: { short?: boolean } = {},
): SessionTiming {
  if (!start) return {};
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return {};
  const from = timeFmt.format(d);
  const end = new Date(d.getTime() + minutes * 60_000);
  return {
    date: opts.short ? dayShortFmt.format(d) : dateFmt.format(d),
    range: `${from} – ${timeFmt.format(end)}`,
    duration: formatDuration(minutes),
  };
}
