import type { APIRoute } from "astro";
import { Resend } from "resend";
import { getContactRecipients } from "../../lib/contacts";

export const prerender = false;

interface ContactPayload {
  name?: string;
  firstname?: string;
  email?: string;
  message?: string;
  recipient?: string;
  for_name?: string;
}

export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.RESEND_API_KEY;
  const from =
    import.meta.env.CONTACT_FROM_EMAIL ?? "La Parent'elle <contact@example.com>";

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Email service not configured." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: ContactPayload;
  try {
    body = (await request.json()) as ContactPayload;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid payload." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const name = body.name?.trim();
  const firstname = body.firstname?.trim();
  const email = body.email?.trim();
  const message = body.message?.trim();
  const recipientEmail = body.recipient?.trim();

  if (!name || !firstname || !email || !message || !recipientEmail) {
    return new Response(JSON.stringify({ error: "Missing fields." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Never trust the client-submitted address: only deliver to known recipients.
  const allowlist = await getContactRecipients();
  const recipient = allowlist.find((r) => r.email === recipientEmail);
  if (!recipient) {
    return new Response(JSON.stringify({ error: "Unknown recipient." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Optional intended recipient (person page without email → admin address).
  // Sanitized: single line, capped length — it ends up in the subject.
  const forName = body.for_name?.replace(/[\r\n]+/g, " ").trim().slice(0, 120);

  const resend = new Resend(apiKey);
  const subject = forName
    ? `Message pour ${forName} — La Parent'elle`
    : `Nouveau message pour ${recipient.name} — La Parent'elle`;
  const { error } = await resend.emails.send({
    from,
    to: recipient.email,
    replyTo: email,
    subject,
    text: `${firstname} ${name} <${email}>\nDestinataire : ${recipient.name}${forName ? `\nPour : ${forName}` : ""}\n\n${message}`,
  });

  if (error) {
    return new Response(JSON.stringify({ error: "Send failed." }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
