import type { APIRoute } from "astro";
import { Resend } from "resend";
import {
  createBooking,
  countBookings,
  isBookingsConfigured,
  resolveSessionRecipients,
} from "../../lib/bookings";

export const prerender = false;

interface BookPayload {
  session_uid?: string;
  session_title?: string;
  session_start?: string;
  name?: string;
  firstname?: string;
  email?: string;
  phone?: string;
  website?: string; // honeypot
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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

  const capacity = Number(body.session_capacity);
  const safeCapacity = Number.isFinite(capacity) ? capacity : 0;

  try {
    const taken = await countBookings(sessionUid);
    if (safeCapacity > 0 && taken >= safeCapacity) {
      return json({ error: "Ce créneau est complet." }, 409);
    }

    // Route the request to the session's practitioner(s), admin fallback.
    // Resolution failures also fall back to admin — a booking must never
    // go out without a notification.
    let recipients: { name: string; email: string }[] = [];
    try {
      recipients = await resolveSessionRecipients(sessionUid);
    } catch (err) {
      console.error("recipient resolution failed, using admin fallback", err);
    }

    await createBooking({ session_uid: sessionUid, name: `${firstname} ${name}`, email, phone });

    const to = recipients.length
      ? recipients.map((r) => r.email)
      : (import.meta.env.CONTACT_TO_EMAIL ?? "laparentelle.contact@gmail.com");
    const who = recipients.length
      ? recipients.map((r) => r.name).join(", ")
      : "l'administratif";

    const apiKey = import.meta.env.RESEND_API_KEY;
    if (apiKey) {
      const resend = new Resend(apiKey);
      const from =
        import.meta.env.CONTACT_FROM_EMAIL ??
        "La Parent'elle <contact@example.com>";
      const when = body.session_start
        ? new Date(body.session_start).toLocaleString("fr-FR", {
            dateStyle: "full",
            timeStyle: "short",
            timeZone: "Europe/Paris",
          })
        : body.session_title;
      await resend.emails.send({
        from,
        to,
        replyTo: email,
        subject: `Demande de créneau — ${body.session_title ?? sessionUid}`,
        text: [
          `Nouvelle demande pour ${who} :`,
          `  ${body.session_title ?? sessionUid}`,
          `  ${when}`,
          "",
          `De : ${firstname} ${name} <${email}>${phone ? ` — ${phone}` : ""}`,
          "",
          `Répondez directement à ce message pour confirmer ou proposer un autre créneau.`,
        ].join("\n"),
      });
    }
  } catch (err) {
    console.error("booking failed", err);
    return json({ error: "La réservation n'a pas abouti. Réessayez." }, 502);
  }

  return json({ ok: true }, 200);
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
