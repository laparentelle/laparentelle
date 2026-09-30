/**
 * Token-based booking cancellations (server-side only).
 *
 * Clients and practitioners do not have accounts, so each booking carries two
 * unguessable tokens: one in the client confirmation email and one in the
 * practitioner/admin notification email.
 */

import { Resend } from "resend";
import {
  cancelConfirmedBooking,
  countBookings,
  getBookingByToken,
  isBookingsConfigured,
  isCancellationToken,
  type BookingRecord,
  type BookingSessionSnapshot,
  type CancellationActor,
} from "./bookings";
import {
  fetchSession,
  fetchSessionPractitioners,
  sessionTiming,
  type SessionRecord,
} from "./sessions";
import {
  buildCalendarAttachment,
  type CalendarAttachment,
} from "./calendar";

export const CLIENT_CANCEL_DEADLINE_HOURS = 24;
const REASON_MAX = 500;

const TYPE_LABELS: Record<string, string> = {
  activite: "Activité",
  sport: "Sport",
  bienetre: "Bien-être",
  consultation: "Consultation",
};

export interface CancellationSession {
  uid: string;
  title: string;
  type?: string;
  start?: string;
  duration?: number;
  capacity?: number;
  note?: string;
  practitioner?: string;
  profileUrl?: string;
  recipientEmails: string[];
}

export type CancellationState =
  | "ok"
  | "unavailable"
  | "invalid"
  | "already"
  | "missing"
  | "past"
  | "too-late"
  | "error";

export interface CancellationContext {
  state: CancellationState;
  booking?: BookingRecord;
  actor?: CancellationActor;
  session?: CancellationSession;
  reasonRequired?: boolean;
  message?: string;
}

export type CancellationOutcome =
  | {
      ok: true;
      already: boolean;
      booking: BookingRecord;
      actor: CancellationActor;
      session: CancellationSession;
      notifications: "sent" | "skipped" | "failed";
    }
  | { ok: false; status: number; error: string };

function adminEmail(): string {
  return import.meta.env.CONTACT_TO_EMAIL ?? "laparentelle.contact@gmail.com";
}

function cleanReason(reason: unknown): string {
  if (typeof reason !== "string") return "";
  return reason.replace(/[\r\n]+/g, " ").trim().slice(0, REASON_MAX);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface CancellationRecipients {
  names: string;
  emails: string[];
  profileUrl?: string;
}

async function resolveCancellationRecipients(
  booking: BookingRecord,
  snapshot: BookingSessionSnapshot | null | undefined,
  sessionUid: string,
  origin: string,
): Promise<CancellationRecipients> {
  // Prefer live Storyblok recipients so practitioner changes are honoured.
  // Fall back to the booking snapshot when the session was deleted or the
  // lookup fails; a cancellation must still notify someone.
  if (sessionUid) {
    try {
      const live = await fetchSession(sessionUid);
      if (live) {
        const practitioners = await fetchSessionPractitioners(live);
        const recipients = practitioners.filter((p) => p.email);
        if (recipients.length) {
          const profiles = recipients.flatMap((p) =>
            p.url?.startsWith("/")
              ? [{ name: p.name, url: new URL(p.url, origin).toString() }]
              : [],
          );
          return {
            names: recipients.map((p) => p.name).join(", "),
            emails: recipients.map((p) => p.email as string),
            profileUrl: profiles[0]?.url,
          };
        }
      }
    } catch (err) {
      console.error("cancellation recipient resolution failed", err);
    }
  }

  const stored = snapshot?.practitioners ?? [];
  const emails = [
    ...new Set(
      [...(snapshot?.recipientEmails ?? []), ...stored.map((p) => p.email ?? "")]
        .map((email) => email.trim())
        .filter(Boolean),
    ),
  ];
  if (!emails.length) return { names: "", emails: [] };

  const named = emails.map((email) => {
    const person = stored.find((p) => p.email === email);
    const url =
      person?.url?.startsWith("/") === true
        ? new URL(person.url as string, origin).toString()
        : undefined;
    return {
      name: person?.name?.trim() || email.split("@")[0] || email,
      email,
      url,
    };
  });

  return {
    names: named.map((p) => p.name).join(", "),
    emails: named.map((p) => p.email),
    profileUrl: named.map((p) => p.url).find(Boolean),
  };
}

async function buildCancellationSession(
  booking: BookingRecord,
  origin: string,
): Promise<CancellationSession> {
  const snapshot = booking.session_snapshot ?? null;
  const sessionUid = snapshot?.uid || booking.session_uid;
  const recipients = await resolveCancellationRecipients(
    booking,
    snapshot,
    sessionUid,
    origin,
  );

  let live: SessionRecord | null = null;
  if (!snapshot?.title || !snapshot?.start) {
    try {
      live = sessionUid ? await fetchSession(sessionUid) : null;
    } catch (err) {
      console.error("cancellation session lookup failed", err);
    }
  }

  return {
    uid: sessionUid,
    title: snapshot?.title || live?.title || "Séance",
    type: snapshot?.type ?? live?.type,
    start: snapshot?.start ?? live?.start,
    duration: snapshot?.duration ?? live?.duration ?? 60,
    capacity: snapshot?.capacity ?? live?.capacity,
    note: snapshot?.note ?? live?.note,
    practitioner: recipients.names || undefined,
    profileUrl: recipients.profileUrl,
    recipientEmails: recipients.emails,
  };
}

function cancellationDeadlineMs(): number {
  return CLIENT_CANCEL_DEADLINE_HOURS * 3_600_000;
}

export async function getCancellationContext(
  token: string,
  requestUrl: string,
): Promise<CancellationContext> {
  if (!isBookingsConfigured()) {
    return {
      state: "unavailable",
      message: "L’annulation en ligne est momentanément indisponible.",
    };
  }

  const cleanToken = token.trim();
  if (!isCancellationToken(cleanToken)) {
    return {
      state: "invalid",
      message: "Ce lien d’annulation est invalide ou expiré.",
    };
  }

  let origin = "";
  try {
    origin = new URL(requestUrl).origin;
  } catch {
    return { state: "error", message: "Lien d’annulation invalide." };
  }

  let found = null;
  try {
    found = await getBookingByToken(cleanToken);
  } catch (err) {
    console.error("cancellation lookup failed", err);
    return {
      state: "error",
      message: "La demande n’a pas pu être vérifiée. Réessayez.",
    };
  }
  if (!found) {
    return {
      state: "invalid",
      message: "Ce lien d’annulation est invalide ou expiré.",
    };
  }

  const session = await buildCancellationSession(found.booking, origin);
  if (found.booking.status === "cancelled") {
    return {
      state: "already",
      booking: found.booking,
      actor: found.actor,
      session,
      message: "Cette demande a déjà été annulée.",
    };
  }

  const startsAt = session.start ? new Date(session.start) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) {
    return {
      state: "missing",
      booking: found.booking,
      actor: found.actor,
      session,
      message:
        "Les informations de la séance sont incomplètes. Contactez-nous pour annuler.",
    };
  }

  const now = Date.now();
  if (startsAt.getTime() <= now) {
    return {
      state: "past",
      booking: found.booking,
      actor: found.actor,
      session,
      message: "Cette séance est déjà passée. Contactez-nous si besoin.",
    };
  }

  if (
    found.actor === "client" &&
    startsAt.getTime() - now < cancellationDeadlineMs()
  ) {
    return {
      state: "too-late",
      booking: found.booking,
      actor: found.actor,
      session,
      reasonRequired: false,
      message: `L’annulation en ligne est possible jusqu’à ${CLIENT_CANCEL_DEADLINE_HOURS} heures avant la séance. Contactez-nous directement.`,
    };
  }

  return {
    state: "ok",
    booking: found.booking,
    actor: found.actor,
    session,
    reasonRequired: found.actor === "staff",
  };
}

function sessionRows(
  session: CancellationSession,
  leftAfter?: number,
): [string, string][] {
  const timing = sessionTiming(session.start, session.duration ?? 60);
  return (
    [
      ["Séance", session.title],
      ["Date", timing.date],
      [
        "Horaire",
        timing.range
          ? `${timing.range}${timing.duration ? ` (${timing.duration})` : ""}`
          : undefined,
      ],
      [
        "Catégorie",
        session.type ? (TYPE_LABELS[session.type] ?? session.type) : undefined,
      ],
      ["Praticien·ne", session.practitioner],
      [
        "Places",
        leftAfter === undefined
          ? undefined
          : `${leftAfter} restante${leftAfter > 1 ? "s" : ""}`,
      ],
      ["Précisions", session.note],
      [
        "Fiche",
        session.profileUrl && session.practitioner
          ? `${session.practitioner} <${session.profileUrl}>`
          : session.profileUrl,
      ],
    ] as [string, string | undefined][]
  ).filter(([, value]) => Boolean(value)) as [string, string][];
}

function emailRow(label: string, value: string): string {
  return `<tr><td style="padding:4px 14px 4px 0;color:#6b7f78;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`;
}

function sessionHtmlRow(
  [label, value]: [string, string],
  profileUrl?: string,
  practitioner?: string,
): string {
  if (label === "Fiche" && profileUrl) {
    const text = practitioner ?? profileUrl;
    return `<tr><td style="padding:4px 14px 4px 0;color:#6b7f78;white-space:nowrap;vertical-align:top">Fiche</td><td style="padding:4px 0"><a style="color:#2e5249" href="${escapeHtml(profileUrl)}">${escapeHtml(text)}</a></td></tr>`;
  }
  return emailRow(label, value);
}

async function sendCancellationEmails({
  booking,
  actor,
  session,
  origin,
  hostname,
  reason,
  leftAfter,
}: {
  booking: BookingRecord;
  actor: CancellationActor;
  session: CancellationSession;
  origin: string;
  hostname: string;
  reason: string;
  leftAfter?: number;
}): Promise<"sent" | "skipped"> {
  const apiKey = import.meta.env.RESEND_API_KEY;
  if (!apiKey) return "skipped";

  const resend = new Resend(apiKey);
  const from =
    import.meta.env.CONTACT_FROM_EMAIL ?? "La Parent'elle <contact@example.com>";
  const admin = adminEmail();
  const practitionerEmails = session.recipientEmails.length
    ? session.recipientEmails
    : [admin];
  const timing = sessionTiming(session.start, session.duration ?? 60);
  const rows = sessionRows(session, leftAfter);
  const attachment = buildCalendarAttachment({
    uid: booking.ics_uid ?? `${booking.session_uid}@${hostname}`,
    filename: `annulation-${booking.session_uid}.ics`,
    title: session.title,
    summaryPrefix: "Annulation",
    start: session.start,
    duration: session.duration ?? 60,
    practitioner: session.practitioner,
    note: session.note,
    profileUrl: session.profileUrl,
    method: "CANCEL",
    status: "CANCELLED",
    sequence: 1,
  });
  const attachments = attachment ? [attachment] : undefined;
  const calendarText = attachment
    ? "\n\nLe fichier joint met à jour votre agenda."
    : "";
  const calendarHtml = attachment
    ? `<p style="margin:12px 0 0;color:#6b7f78;font-size:14px">Le fichier joint met à jour votre agenda.</p>`
    : "";

  const requester = [
    ["Nom", booking.name],
    ["Email", booking.email],
    ["Téléphone", booking.phone ?? undefined],
  ].filter(([, value]) => Boolean(value)) as [string, string][];

  const practitionerIntro =
    actor === "client"
      ? "Le client a annulé la demande suivante :"
      : "Une annulation praticien a été enregistrée pour la demande suivante :";
  const practitionerSubject = `Annulation — ${session.title}${timing.date ? ` — ${timing.date}` : ""}`;
  const practitionerText = [
    practitionerIntro,
    "",
    ...rows.map(([label, value]) => `  ${label.padEnd(15, " ")} ${value}`),
    "",
    "Demandeur",
    ...requester.map(([label, value]) => `  ${label.padEnd(15, " ")} ${value}`),
    ...(reason ? ["", `Motif : ${reason}`] : []),
    "",
    "La place est de nouveau disponible sur le planning.",
  ].join("\n");
  const practitionerHtml = `<div style="font-family:Jost,system-ui,sans-serif;color:#233a34;line-height:1.5">
  <p style="margin:0 0 16px"><strong>${escapeHtml(practitionerIntro)}</strong></p>
  <table style="font-size:15px;border-collapse:collapse;margin:0 0 20px">${rows
    .map((line) => sessionHtmlRow(line, session.profileUrl, session.practitioner))
    .join("")}</table>
  <p style="margin:0 0 6px;color:#6b7f78;font-size:13px;letter-spacing:.08em;text-transform:uppercase">Demandeur</p>
  <table style="font-size:15px;border-collapse:collapse;margin:0 0 20px">${requester
    .map(([label, value]) => emailRow(label, value))
    .join("")}</table>
  ${reason ? `<p style="margin:0 0 16px">Motif : ${escapeHtml(reason)}</p>` : ""}
  <p style="margin:0;color:#6b7f78;font-size:14px">La place est de nouveau disponible sur le planning.</p>
  ${calendarHtml}
</div>`;
  const practitionerResult = await resend.emails.send({
    from,
    to: practitionerEmails,
    replyTo: booking.email,
    subject: practitionerSubject,
    text: practitionerText,
    html: practitionerHtml,
    attachments,
  });
  if (practitionerResult.error) throw new Error(practitionerResult.error.message);

  const clientIntro =
    actor === "client"
      ? "Vous avez annulé votre demande :"
      : "Le praticien a annulé votre demande :";
  const clientSubject = `Annulation de votre demande — ${session.title}${timing.date ? ` — ${timing.date}` : ""}`;
  const clientText = [
    `Bonjour ${booking.name},`,
    "",
    clientIntro,
    "",
    ...rows.map(([label, value]) => `  ${label.padEnd(15, " ")} ${value}`),
    ...(reason ? ["", `Motif : ${reason}`] : []),
    "",
    "N’hésitez pas à choisir un autre créneau ou à nous contacter.",
  ].join("\n") + calendarText;
  const clientHtml = `<div style="font-family:Jost,system-ui,sans-serif;color:#233a34;line-height:1.5">
  <p style="margin:0 0 16px">Bonjour ${escapeHtml(booking.name)},</p>
  <p style="margin:0 0 16px"><strong>${escapeHtml(clientIntro)}</strong></p>
  <table style="font-size:15px;border-collapse:collapse;margin:0 0 20px">${rows
    .map((line) => sessionHtmlRow(line, session.profileUrl, session.practitioner))
    .join("")}</table>
  ${reason ? `<p style="margin:0 0 16px">Motif : ${escapeHtml(reason)}</p>` : ""}
  <p style="margin:0;color:#6b7f78;font-size:14px">N’hésitez pas à choisir un autre créneau ou à nous contacter.</p>
  ${calendarHtml}
</div>`;
  const clientResult = await resend.emails.send({
    from,
    to: booking.email,
    replyTo: practitionerEmails,
    subject: clientSubject,
    text: clientText,
    html: clientHtml,
    attachments,
  });
  if (clientResult.error) throw new Error(clientResult.error.message);

  return "sent";
}

export async function performCancellation({
  token,
  reason,
  requestUrl,
}: {
  token: string;
  reason?: unknown;
  requestUrl: string;
}): Promise<CancellationOutcome> {
  if (!isBookingsConfigured()) {
    return { ok: false, status: 503, error: "Annulation en ligne indisponible." };
  }

  const cleanToken = token.trim();
  if (!isCancellationToken(cleanToken)) {
    return { ok: false, status: 404, error: "Ce lien d’annulation est invalide ou expiré." };
  }

  let origin = "";
  let hostname = "";
  try {
    const url = new URL(requestUrl);
    origin = url.origin;
    hostname = url.hostname;
  } catch {
    return { ok: false, status: 400, error: "Lien d’annulation invalide." };
  }

  let found = null;
  try {
    found = await getBookingByToken(cleanToken);
  } catch (err) {
    console.error("cancellation lookup failed", err);
    return { ok: false, status: 502, error: "La demande n’a pas pu être vérifiée. Réessayez." };
  }
  if (!found) {
    return { ok: false, status: 404, error: "Ce lien d’annulation est invalide ou expiré." };
  }

  if (found.booking.status === "cancelled") {
    const session = await buildCancellationSession(found.booking, origin);
    return {
      ok: true,
      already: true,
      booking: found.booking,
      actor: found.actor,
      session,
      notifications: "skipped",
    };
  }

  const context = await getCancellationContext(cleanToken, requestUrl);
  if (context.state !== "ok" || !context.booking || !context.session || !context.actor) {
    const status = context.state === "too-late" || context.state === "past" ? 410 : 400;
    return {
      ok: false,
      status,
      error: context.message ?? "Cette demande ne peut pas être annulée en ligne.",
    };
  }

  const reasonText = cleanReason(reason);
  if (context.actor === "staff" && !reasonText) {
    return { ok: false, status: 400, error: "Merci d’indiquer un motif d’annulation." };
  }

  let updated: BookingRecord | null = null;
  try {
    updated = await cancelConfirmedBooking(context.booking.id, context.actor, reasonText);
  } catch (err) {
    console.error("cancellation update failed", err);
    return { ok: false, status: 502, error: "L’annulation n’a pas abouti. Réessayez." };
  }
  if (!updated) {
    const reread = await getBookingByToken(cleanToken).catch(() => null);
    if (reread?.booking.status === "cancelled") {
      const session = await buildCancellationSession(reread.booking, origin);
      return {
        ok: true,
        already: true,
        booking: reread.booking,
        actor: reread.actor,
        session,
        notifications: "skipped",
      };
    }
    return { ok: false, status: 409, error: "Cette demande vient d’être modifiée. Rechargez la page." };
  }

  let leftAfter: number | undefined;
  if (context.session.capacity && context.session.capacity > 0) {
    try {
      const takenAfter = await countBookings(updated.session_uid);
      leftAfter = Math.max(0, context.session.capacity - takenAfter);
    } catch (err) {
      console.error("cancelled availability recount failed", err);
    }
  }

  let notifications: "sent" | "skipped" | "failed" = "skipped";
  try {
    notifications = await sendCancellationEmails({
      booking: updated,
      actor: context.actor,
      session: context.session,
      origin,
      hostname,
      reason: reasonText,
      leftAfter,
    });
  } catch (err) {
    console.error("cancellation notification failed", err);
    notifications = "failed";
  }

  return {
    ok: true,
    already: false,
    booking: updated,
    actor: context.actor,
    session: context.session,
    notifications,
  };
}
