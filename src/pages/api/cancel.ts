import type { APIRoute } from "astro";
import {
  isBookingsConfigured,
  isCancellationToken,
} from "../../lib/bookings";
import { performCancellation } from "../../lib/cancellation";

export const prerender = false;

interface CancelPayload {
  token?: string;
  reason?: string;
}

export const POST: APIRoute = async ({ request }) => {
  if (!isBookingsConfigured()) {
    return json({ error: "Annulation en ligne indisponible." }, 503);
  }

  let body: CancelPayload;
  try {
    body = (await request.json()) as CancelPayload;
  } catch {
    return json({ error: "Requête invalide." }, 400);
  }

  const token = body.token?.trim() ?? "";
  if (!isCancellationToken(token)) {
    return json({ error: "Ce lien d’annulation est invalide ou expiré." }, 404);
  }

  const outcome = await performCancellation({
    token,
    reason: body.reason,
    requestUrl: request.url,
  });

  if (!outcome.ok) {
    return json({ error: outcome.error }, outcome.status);
  }

  return json(
    {
      ok: true,
      already: outcome.already,
      actor: outcome.actor,
      notifications: outcome.notifications,
    },
    200,
  );
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
