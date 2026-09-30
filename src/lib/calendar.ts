/**
 * iCalendar payloads for booking confirmations and cancellations.
 * Server-side only: responses are attached to Resend emails.
 */

export type CalendarMethod = "PUBLISH" | "CANCEL";
export type CalendarStatus = "TENTATIVE" | "CANCELLED" | "CONFIRMED";

export interface CalendarEventDetails {
  /** Stable UID for one booking; cancellations must reuse the original UID. */
  uid: string;
  filename: string;
  /** Event title without the demande/annulation prefix. */
  title: string;
  summaryPrefix?: string;
  start?: string;
  duration?: number;
  location?: string;
  practitioner?: string;
  note?: string;
  profileUrl?: string;
  method?: CalendarMethod;
  status?: CalendarStatus;
  sequence?: number;
}

export interface CalendarAttachment {
  filename: string;
  /** Base64-encoded `.ics` content, as expected by the Resend API. */
  content: string;
  contentType: string;
}

function toIcsTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Fold an iCalendar content line at 75 octets without splitting UTF-8 bytes. */
function foldIcsLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let start = 0;
  let first = true;

  while (start < bytes.length) {
    let end = Math.min(start + (first ? 75 : 74), bytes.length);
    while (end > start + 1 && (bytes[end - 1] ?? 0) >= 0x80 && (bytes[end - 1] ?? 0) < 0xc0) {
      end -= 1;
    }
    chunks.push(`${first ? "" : " "}${decoder.decode(bytes.slice(start, end))}`);
    start = end;
    first = false;
  }

  return chunks.join("\r\n");
}

export function buildCalendarAttachment(
  details: CalendarEventDetails,
): CalendarAttachment | undefined {
  const begins = details.start ? new Date(details.start) : null;
  if (!begins || Number.isNaN(begins.getTime())) return undefined;

  const minutes = Number(details.duration);
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 60;
  const ends = new Date(begins.getTime() + safeMinutes * 60_000);
  const description = [
    details.practitioner ? `Praticien·ne : ${details.practitioner}` : undefined,
    details.location ? `Lieu : ${details.location}` : undefined,
    details.note ? `Précisions : ${details.note}` : undefined,
    details.profileUrl ? `Fiche : ${details.profileUrl}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  const method = details.method ?? "PUBLISH";
  const status = details.status ?? "TENTATIVE";
  const sequence = details.sequence ?? 0;
  const summary = details.summaryPrefix
    ? `${details.summaryPrefix} — ${details.title}`
    : details.title;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//La Parent'elle//Reservations//FR",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(details.uid)}`,
    `DTSTAMP:${toIcsTimestamp(new Date())}`,
    `DTSTART:${toIcsTimestamp(begins)}`,
    `DTEND:${toIcsTimestamp(ends)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    ...(description ? [`DESCRIPTION:${escapeIcsText(description)}`] : []),
    ...(details.location ? [`LOCATION:${escapeIcsText(details.location)}`] : []),
    ...(details.profileUrl ? [`URL;VALUE=URI:${escapeIcsText(details.profileUrl)}`] : []),
    `STATUS:${status}`,
    `SEQUENCE:${sequence}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return {
    filename: details.filename,
    content: Buffer.from(lines.map(foldIcsLine).join("\r\n"), "utf8").toString("base64"),
    contentType: `text/calendar; method=${method}`,
  };
}
