// Dates and calendar layout for viewings. Plain functions (no React), so
// server pages, client components and tests share them.
//
// Days are handled as "YYYY-MM-DD" keys in the agency's time zone, so a
// viewing at 23:30 in Warsaw lands on the right day whatever time zone the
// server runs in.

export const DEFAULT_TZ = "Europe/Warsaw";

/** Columns for an appointment with its client, listing and agent. */
export const APPOINTMENT_SELECT =
  "id, starts_at, ends_at, timezone, status, notes, created_at, listing_id, agent_id, conversation_id, " +
  "reminder_sent_at, reminder_channel, client_confirmed_at, cancelled_by, previous_starts_at, " +
  "contact:contacts(id, name, email, phone), " +
  "listing:listings(id, title, reference, address, district, city, photos, image_url, url, price, currency, transaction_type, rooms, area_m2, floor), " +
  "agent:tenant_users(id, full_name, email), " +
  "conversation:conversations(id, channel)";

export type ApptListing = {
  id: string;
  title: string;
  reference: string | null;
  address: string | null;
  district: string | null;
  city: string | null;
  photos: string[] | null;
  image_url: string | null;
  url: string | null;
  price: number | null;
  currency: string;
  transaction_type: string;
  rooms: number | null;
  area_m2: number | null;
  floor: number | null;
};

export type Appointment = {
  id: string;
  starts_at: string;
  ends_at: string;
  timezone: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  listing_id: string | null;
  agent_id: string | null;
  contact: { id?: string; name: string | null; email: string | null; phone: string | null } | null;
  listing: ApptListing | null;
  agent: { id: string; full_name: string | null; email: string } | null;
  /** The conversation the viewing was booked in (0033); null for older or manual bookings. */
  conversation_id?: string | null;
  conversation?: { id: string; channel: string } | null;
  /** 0038: what the client did, and the reminder the day before. */
  reminder_sent_at?: string | null;
  reminder_channel?: string | null;
  client_confirmed_at?: string | null;
  cancelled_by?: string | null;
  previous_starts_at?: string | null;
};

type ClientNoteInput = Pick<
  Appointment,
  "status" | "reminder_sent_at" | "reminder_channel" | "client_confirmed_at" | "cancelled_by" | "previous_starts_at"
>;

/**
 * What the client did with a viewing, for the card and the detail page:
 * "Cancelled by the client", "Client confirmed", "Client moved it from …",
 * "Reminder sent on WhatsApp", "Reminder failed". tone: ok | warn | muted.
 */
export function clientNotes(a: ClientNoteInput, tz: string): { text: string; tone: "ok" | "warn" | "muted" }[] {
  const out: { text: string; tone: "ok" | "warn" | "muted" }[] = [];
  if (a.status === "cancelled" && a.cancelled_by === "client") out.push({ text: "Cancelled by the client", tone: "warn" });
  if (a.status === "confirmed" && a.client_confirmed_at) out.push({ text: "Client confirmed", tone: "ok" });
  if (a.previous_starts_at) out.push({ text: `Client moved it from ${bookedAtLabel(a.previous_starts_at, tz, false)}`, tone: "muted" });
  if (a.status === "confirmed" && a.reminder_sent_at && a.reminder_channel) {
    if (a.reminder_channel.startsWith("failed")) out.push({ text: "Reminder failed", tone: "warn" });
    else if (a.reminder_channel !== "none") out.push({ text: `Reminder sent by ${channelLabel(a.reminder_channel) ?? a.reminder_channel}`, tone: "muted" });
  }
  return out;
}

const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", chat_widget: "website chat", email: "email", sms: "SMS" };

/** "on WhatsApp", "on website chat"... for where a viewing was booked. */
export function channelLabel(channel: string | null | undefined): string | null {
  return channel ? CHANNEL_LABEL[channel] ?? channel.replace(/_/g, " ") : null;
}

/** When a viewing was booked, in the agency's time zone: "9 Nov 2026, 16:12". */
export function bookedAtLabel(createdAt: string, tz: string, withYear = true): string {
  return new Date(createdAt).toLocaleString("en-GB", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type TeamMember = { id: string; full_name: string | null; email: string; role: string };

export const personName = (p: { full_name: string | null; email: string } | null | undefined) =>
  p ? p.full_name || p.email.split("@")[0] : "Unassigned";

/** Short name for tight spaces: "Anna Kowalska" -> "Anna K." */
export function shortName(name: string | null | undefined, fallback = "Client"): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  if (parts[0].includes("@")) return parts[0].split("@")[0];
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}

// ── Day keys ──

/** "YYYY-MM-DD" of an instant, in a time zone. */
export function dayKey(iso: string | Date, tz = DEFAULT_TZ): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export const todayKey = (tz = DEFAULT_TZ) => dayKey(new Date(), tz);

const keyToUtc = (key: string) => new Date(`${key}T00:00:00Z`);
const utcToKey = (d: Date) => d.toISOString().slice(0, 10);

export function isDayKey(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(keyToUtc(v).getTime()) && utcToKey(keyToUtc(v)) === v;
}

export function addDays(key: string, n: number): string {
  const d = keyToUtc(key);
  d.setUTCDate(d.getUTCDate() + n);
  return utcToKey(d);
}

/** Monday of the week a day is in. */
export function weekStart(key: string): string {
  const dow = keyToUtc(key).getUTCDay(); // 0 = Sunday
  return addDays(key, -((dow + 6) % 7));
}

export function addMonths(monthKey: string, n: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return utcToKey(d).slice(0, 7);
}

/** "YYYY-MM" from a ?month= param, or the month of `today`. */
export function parseMonth(param: string | undefined, today: string): string {
  return param && /^\d{4}-(0[1-9]|1[0-2])$/.test(param) ? param : today.slice(0, 7);
}

/** Monday of the week from a ?week= param (any day in it), or this week. */
export function parseWeek(param: string | undefined, today: string): string {
  return weekStart(isDayKey(param) ? param : today);
}

/** Weeks (Monday first) covering a month: 4 to 6 rows of 7 day keys. */
export function monthGrid(monthKey: string): string[][] {
  const first = `${monthKey}-01`;
  const last = addDays(`${addMonths(monthKey, 1)}-01`, -1);
  const weeks: string[][] = [];
  for (let start = weekStart(first); start <= last; start = addDays(start, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
  }
  return weeks;
}

/**
 * UTC bounds that safely cover a range of day keys in any time zone, for a
 * database query. Results are then grouped with dayKey(), which drops the
 * few extra rows the margin lets in.
 */
export function queryBounds(fromKey: string, toKeyExclusive: string) {
  return { from: `${addDays(fromKey, -1)}T00:00:00Z`, to: `${addDays(toKeyExclusive, 1)}T00:00:00Z` };
}

/** Appointments by day key, each day in time order. */
export function groupByDay<T extends { starts_at: string }>(rows: T[], tz = DEFAULT_TZ): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of [...rows].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    const k = dayKey(r.starts_at, tz);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

// ── Labels ──

export function timeOf(iso: string, tz = DEFAULT_TZ): string {
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
}

export const timeRange = (a: { starts_at: string; ends_at: string }, tz = DEFAULT_TZ) => `${timeOf(a.starts_at, tz)}–${timeOf(a.ends_at, tz)}`;

export function dayLabel(key: string, style: "short" | "long" | "weekday" = "short"): string {
  const opts: Intl.DateTimeFormatOptions =
    style === "long"
      ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
      : style === "weekday"
        ? { weekday: "short" }
        : { weekday: "short", day: "numeric", month: "short" };
  return keyToUtc(key).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
}

export function monthLabel(monthKey: string): string {
  return keyToUtc(`${monthKey}-01`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "2–8 Nov 2026", "30 Nov – 6 Dec 2026", "29 Dec 2025 – 4 Jan 2026" */
export function weekLabel(startKey: string): string {
  const end = addDays(startKey, 6);
  const [sy, sm, sd] = startKey.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const mon = (key: string) => keyToUtc(key).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  if (sy !== ey) return `${sd} ${mon(startKey)} ${sy} – ${ed} ${mon(end)} ${ey}`;
  if (sm !== em) return `${sd} ${mon(startKey)} – ${ed} ${mon(end)} ${ey}`;
  return `${sd}–${ed} ${mon(end)} ${ey}`;
}

// ── Listing bits ──

export function listingAddress(l: Pick<ApptListing, "address" | "district" | "city"> | null | undefined): string {
  if (!l) return "";
  return [l.address, l.district, l.city].filter((x) => x && String(x).trim()).join(", ");
}

export function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/** Viewings that are actually happening (calendar views leave cancelled ones out). */
export const isActive = (a: { status: string }) => a.status !== "cancelled";
