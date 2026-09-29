/**
 * Storyblok `datetime` fields come back as UTC ISO ("…T14:00:00.000Z").
 * We also accept the space-separated form Storyblok's own SDK emits
 * ("2026-10-05 08:30:00"), which is UTC without a marker — Date would
 * otherwise read it as local time and shift every session.
 */
export function parseSessionDate(value?: string | null): Date | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  if (/[Zz]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // No timezone marker: treat as UTC.
  const d = new Date(`${raw.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
