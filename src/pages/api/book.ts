import type { APIRoute } from "astro";
import { Resend } from "resend";
import {
  createBooking,
  countBookings,
  isBookingsConfigured,
  resolveSessionRecipients,
  type BookingSessionSnapshot,
} from "../../lib/bookings";
import {
  fetchSession,
  sessionTiming,
  type SessionRecord,
} from "../../lib/sessions";
import { buildCalendarAttachment } from "../../lib/calendar";

export const prerender = false;

interface BookPayload {
  session_uid?: string;
  session_title?: string;
  session_start?: string;
  session_capacity?: string;
  name?: string;
  firstname?: string;
  email?: string;
  phone?: string;
  website?: string; // honeypot
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TYPE_LABELS: Record<string, string> = {
  activite: "Activité",
  sport: "Sport",
  bienetre: "Bien-être",
  consultation: "Consultation",
};

export const POST: APIRoute = async ({ request }) => {
  if (!isBookingsConfigured()) {
    return json({ error: "Réservation en ligne indisponible." }, 503);
  }

  let body: BookPayload;
  try {
    body = (await request.json()) as BookPayload;
  } catch {
    return json({ error: "Requête invalide." }, 400);
  }

  // Honeypot: real users never fill this.
  if (body.website) return json({ ok: true }, 200);

  const sessionUid = body.session_uid?.trim();
  const name = body.name?.replace(/[\r\n]+/g, " ").trim().slice(0, 120);
  const firstname = body.firstname?.replace(/[\r\n]+/g, " ").trim().slice(0, 120);
  const email = body.email?.trim().slice(0, 200);
  const phone = body.phone?.replace(/[\r\n]+/g, " ").trim().slice(0, 40);

  if (!sessionUid || !name || !firstname || !email || !EMAIL_RE.test(email)) {
    return json({ error: "Merci de renseigner nom, prénom et email valides." }, 400);
  }

  try {
    const taken = await countBookings(sessionUid);
    const capacity = Number(body.session_capacity);
    const safeCapacity = Number.isFinite(capacity) ? capacity : 0;

    // Session details come from Storyblok, never from the client payload,
    // so the notification always describes the real slot.
    const session: SessionRecord | null = await fetchSession(sessionUid);

    // Externally-booked slots bypass the planning form entirely.
    if (session?.external_booking) {
      return json(
        { error: "La réservation de ce créneau se fait directement auprès du praticien." },
        400,
      );
    }
    const serverCapacity = session?.capacity ?? safeCapacity;
    if (serverCapacity > 0 && taken >= serverCapacity) {
      return json({ error: "Ce créneau est complet." }, 409);
    }

    // Route the request to the session's practitioner(s), admin fallback.
    // Resolution failures also fall back to admin — a booking must never
    // go out without a notification.
    let recipients: { name: string; email: string; url?: string }[] = [];
    if (session) {
      try {
        recipients = await resolveSessionRecipients(session);
      } catch (err) {
        console.error("recipient resolution failed, using admin fallback", err);
      }
    }

    // Absolute profile and cancellation links are required: relative
    // `/equipe/...` and `/annulation...` paths do not work from email clients.
    const origin = new URL(request.url).origin;
    const hostname = new URL(request.url).hostname;
    const profiles = recipients.flatMap((r) => {
      if (!r.url?.startsWith("/")) return [];
      return [{ name: r.name, url: new URL(r.url, origin).toString() }];
    });

    const adminEmail =
      import.meta.env.CONTACT_TO_EMAIL ?? "laparentelle.contact@gmail.com";
    const to = recipients.length ? recipients.map((r) => r.email) : adminEmail;
    const who = recipients.length
      ? recipients.map((r) => r.name).join(", ")
      : "l'administratif";
    const clientWho = recipients.length ? who : "notre équipe administrative";
    const replyToRecipients = recipients.length
      ? recipients.map((r) => r.email)
      : adminEmail;

    // ---- session details, resolved server-side ----
    const title = session?.title ?? body.session_title ?? "Séance";
    const start = session?.start ?? body.session_start;
    const duration = session?.duration ?? 60;
    const timing = sessionTiming(start, duration);
    const typeLabel = session?.type ? TYPE_LABELS[session.type] : undefined;

    // Cancellation tokens, the calendar UID, and a session snapshot are stored
    // with the booking so the cancellation page works even if Storyblok
    // content later changes.
    const snapshot: BookingSessionSnapshot = {
      uid: session?.uid ?? sessionUid,
      title,
      type: session?.type,
      start,
      duration,
      capacity: serverCapacity,
      note: session?.note,
      practitioners: recipients.map((r) => ({
        name: r.name,
        email: r.email,
        url: r.url,
      })),
      recipientEmails: recipients.map((r) => r.email),
    };
    const calendarUid = `${crypto.randomUUID()}@${hostname}`;
    const created = await createBooking({
      session_uid: sessionUid,
      name: `${firstname} ${name}`,
      email,
      phone,
      client_token: crypto.randomUUID(),
      staff_token: crypto.randomUUID(),
      session_snapshot: snapshot,
      ics_uid: calendarUid,
    });
    const clientCancelUrl = new URL(
      `/annulation?token=${created.client_token}`,
      origin,
    ).toString();
    const staffCancelUrl = new URL(
      `/annulation?token=${created.staff_token}`,
      origin,
    ).toString();

    const apiKey = import.meta.env.RESEND_API_KEY;
    if (apiKey) {
      const resend = new Resend(apiKey);
      const from =
        import.meta.env.CONTACT_FROM_EMAIL ??
        "La Parent'elle <contact@example.com>";

      // Re-count after the insert so notifications show the places left
      // after this booking, not the pre-booking availability.
      const takenAfter = await countBookings(sessionUid);
      const left = serverCapacity > 0 ? Math.max(0, serverCapacity - takenAfter) : undefined;

      const sessionLines = (
        [
          ["Séance", title],
          ["Date", timing.date],
          [
            "Horaire",
            timing.range
              ? `${timing.range}${timing.duration ? ` (${timing.duration})` : ""}`
              : undefined,
          ],
          ["Catégorie", typeLabel],
          ["Praticien·ne", recipients.length ? who : undefined],
          [
            "Places",
            left === undefined ? undefined : `${left} restante${left > 1 ? "s" : ""}`,
          ],
          ["Précisions", session?.note],
          [
            "Fiche",
            profiles.map((p) => `${p.name} <${p.url}>`).join(", "),
          ],
        ] as [string, string | undefined][]
      ).filter(([, v]) => Boolean(v)) as [string, string][];

      const contactLines = (
        [
          ["Prénom", firstname],
          ["Nom", name],
          ["Email", email],
          ["Téléphone", phone],
        ] as [string, string | undefined][]
      ).filter(([, v]) => Boolean(v)) as [string, string][];

      const subject = `Demande de réservation — ${title}${timing.date ? ` — ${timing.date}` : ""}`;

      const text = [
        `Nouvelle demande de réservation pour ${who} :`,
        "",
        ...sessionLines.map(([k, v]) => `  ${k.padEnd(15, " ")} ${v}`),
        "",
        "Demandeur",
        ...contactLines.map(([k, v]) => `  ${k.padEnd(15, " ")} ${v}`),
        "",
        `Annuler cette demande : ${staffCancelUrl}`,
        "",
        "Répondez directement à ce message pour confirmer ou proposer un autre créneau.",
      ].join("\n");

      const row = (label: string, value: string) =>
        `<tr><td style="padding:4px 14px 4px 0;color:#6b7f78;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`;
      const ficheLinksHtml = profiles
        .map(
          (p) =>
            `<a style="color:#2e5249" href="${escapeHtml(p.url)}">${escapeHtml(p.name)}</a>`,
        )
        .join(", ");
      const sessionRow = ([label, value]: [string, string]) =>
        label === "Fiche" && ficheLinksHtml
          ? `<tr><td style="padding:4px 14px 4px 0;color:#6b7f78;white-space:nowrap;vertical-align:top">Fiche</td><td style="padding:4px 0">${ficheLinksHtml}</td></tr>`
          : row(label, value);

      const html = `<div style="font-family:Jost,system-ui,sans-serif;color:#233a34;line-height:1.5">
  <p style="margin:0 0 16px"><strong>Nouvelle demande de réservation pour ${escapeHtml(who)}</strong></p>
  <table style="font-size:15px;border-collapse:collapse;margin:0 0 20px">${sessionLines
    .map(sessionRow)
    .join("")}</table>
  <p style="margin:0 0 6px;color:#6b7f78;font-size:13px;letter-spacing:.08em;text-transform:uppercase">Demandeur</p>
  <table style="font-size:15px;border-collapse:collapse;margin:0 0 20px">${contactLines
    .map(([k, v]) => row(k, v))
    .join("")}</table>
  <p style="margin:0 0 16px"><a style="color:#2e5249" href="${staffCancelUrl}">Annuler cette demande</a></p>
  <p style="margin:0;color:#6b7f78;font-size:14px">Répondez directement à ce message pour confirmer ou proposer un autre créneau.</p>
</div>`;

      const practitionerEmail = await resend.emails.send({
        from,
        to,
        replyTo: email,
        subject,
        text,
        html,
      });
      if (practitionerEmail.error) {
        throw new Error(practitionerEmail.error.message);
      }

      const responder = recipients.length ? who : "Notre équipe administrative";
      const clientSubject = `Votre demande de réservation — ${title}${timing.date ? ` — ${timing.date}` : ""}`;
      const calendarAttachment = buildCalendarAttachment({
        uid: created.ics_uid ?? calendarUid,
        filename: `demande-reservation-${sessionUid}.ics`,
        title,
        summaryPrefix: "Demande de réservation",
        start,
        duration,
        practitioner: recipients.length ? who : undefined,
        note: session?.note,
        profileUrl: profiles[0]?.url,
        method: "PUBLISH",
        status: "TENTATIVE",
        sequence: 0,
      });
      const calendarNoteText = calendarAttachment
        ? "\n\nLe fichier joint permet d’ajouter ce créneau à votre agenda."
        : "";
      const calendarNoteHtml = calendarAttachment
        ? `<p style="margin:12px 0 0;color:#6b7f78;font-size:14px">Le fichier joint permet d’ajouter ce créneau à votre agenda.</p>`
        : "";
      const clientText = [
        `Bonjour ${firstname} ${name},`,
        "",
        `Votre demande de réservation a bien été transmise à ${clientWho} :`,
        "",
        ...sessionLines.map(([k, v]) => `  ${k.padEnd(15, " ")} ${v}`),
        "",
        "Vos coordonnées",
        ...contactLines.map(([k, v]) => `  ${k.padEnd(15, " ")} ${v}`),
        "",
        `${responder} vous répondra pour confirmer ou proposer un autre créneau.`,
        "",
        `Annuler ma demande : ${clientCancelUrl}`,
      ].join("\n") + calendarNoteText;
      const clientHtml = `<div style="font-family:Jost,system-ui,sans-serif;color:#233a34;line-height:1.5">
  <p style="margin:0 0 16px">Bonjour ${escapeHtml(`${firstname} ${name}`)},</p>
  <p style="margin:0 0 16px">Votre demande de réservation a bien été transmise à <strong>${escapeHtml(clientWho)}</strong> :</p>
  <table style="font-size:15px;border-collapse:collapse;margin:0 0 20px">${sessionLines
    .map(sessionRow)
    .join("")}</table>
  <p style="margin:0 0 6px;color:#6b7f78;font-size:13px;letter-spacing:.08em;text-transform:uppercase">Vos coordonnées</p>
  <table style="font-size:15px;border-collapse:collapse;margin:0 0 20px">${contactLines
    .map(([k, v]) => row(k, v))
    .join("")}</table>
  <p style="margin:0;color:#6b7f78;font-size:14px">${escapeHtml(responder)} vous répondra pour confirmer ou proposer un autre créneau.</p>
  <p style="margin:12px 0 0;font-size:14px"><a style="color:#2e5249" href="${clientCancelUrl}">Annuler ma demande</a></p>
  ${calendarNoteHtml}
</div>`;

      const clientEmail = await resend.emails.send({
        from,
        to: email,
        replyTo: replyToRecipients,
        subject: clientSubject,
        text: clientText,
        html: clientHtml,
        attachments: calendarAttachment ? [calendarAttachment] : undefined,
      });
      if (clientEmail.error) {
        throw new Error(clientEmail.error.message);
      }
    }
  } catch (err) {
    console.error("booking failed", err);
    return json({ error: "La réservation n'a pas abouti. Réessayez." }, 502);
  }

  return json({ ok: true }, 200);
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Calendar payloads live in `src/lib/calendar.ts` so cancellations reuse them. */

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
