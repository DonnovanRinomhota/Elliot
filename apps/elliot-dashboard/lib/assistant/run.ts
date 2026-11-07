// Answers a parsed question (lib/assistant/parse.ts) from the agency's own
// data, through the signed-in user's database connection, so row-level
// security means it only ever sees that agency. No AI service involved.

import type { SupabaseClient } from "@supabase/supabase-js";
import { contactLabel } from "@/lib/contacts";
import { formatPrice } from "@/lib/listings";
import { listingPhotos } from "@/lib/listing-photos";
import { resizedPhotoUrl } from "@/lib/google-drive";
import { addDays, dayKey, dayLabel, DEFAULT_TZ, personName, timeOf } from "@/lib/appointments";
import { EXAMPLES, fold, placeStem, type Entity, type Intent, type ListingFilters, type Range } from "./parse";

export type AnswerItem = {
  title: string;
  subtitle?: string;
  meta?: string;
  href?: string;
  image?: string;
  badge?: { label: string; tone: "blue" | "amber" | "red" | "gray" };
};

export type Answer = {
  /** One plain sentence: the answer. */
  text: string;
  items?: AnswerItem[];
  more?: { label: string; href: string };
  /** Follow-up questions to offer. */
  suggestions?: string[];
  /** Take the user straight to a page. */
  navigate?: string;
};

type Ctx = { supabase: SupabaseClient; tz: string; me: { id: string; full_name: string | null; email: string } | null; now: Date };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** UTC instants for a range of local days (start of `from` to start of `to`). */
function bounds(r: Range, tz: string) {
  return { from: localMidnight(r.from, tz), to: localMidnight(r.to, tz) };
}

/** The UTC instant of 00:00 on a day in a time zone. */
export function localMidnight(day: string, tz: string): string {
  const guess = new Date(`${day}T00:00:00Z`);
  // How far the zone is ahead of UTC at that moment (handles summer time).
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  const offset = asIfUtc - guess.getTime();
  return new Date(guess.getTime() - offset).toISOString();
}

const LEAD_TONE: Record<string, AnswerItem["badge"]> = {
  HOT: { label: "Hot", tone: "red" },
  WARM: { label: "Warm", tone: "amber" },
  NEW: { label: "New", tone: "blue" },
  QUALIFYING: { label: "Qualifying", tone: "blue" },
  COLD: { label: "Cold", tone: "gray" },
  CONVERTED: { label: "Converted", tone: "blue" },
  LOST: { label: "Lost", tone: "gray" },
};

const ENTITY_NOUN: Record<Entity, [string, string]> = {
  leads: ["lead", "leads"],
  conversations: ["conversation", "conversations"],
  viewings: ["viewing", "viewings"],
  escalations: ["open handover", "open handovers"],
  approvals: ["email waiting for approval", "emails waiting for approval"],
  listings: ["available listing", "available listings"],
  contacts: ["contact", "contacts"],
};

export async function answer(intent: Intent, ctx: Ctx): Promise<Answer> {
  switch (intent.kind) {
    case "help":
      return {
        text: "Ask me about your leads, viewings, chats, listings and people. I look things up in your own data; nothing leaves Elliot.",
        suggestions: EXAMPLES,
      };
    case "navigate":
      return { text: `Opening ${intent.label}.`, navigate: intent.href };
    case "needs_me":
      return needsMe(ctx);
    case "count":
      return count(intent.entity, intent.range, intent.status, intent.booked ?? false, intent.list, ctx);
    case "schedule":
      return schedule(intent.range, intent.mine, ctx);
    case "hot_leads":
      return hotLeads(ctx);
    case "unassigned":
      return unassigned(ctx);
    case "listings":
      return listings(intent.filters, ctx);
    case "person":
      return people(intent.query, ctx);
    case "search":
      return search(intent.query, ctx);
  }
}

// ── What needs me ──

async function needsMe({ supabase, me, tz, now }: Ctx): Promise<Answer> {
  const today = dayKey(now, tz);
  const [esc, drafts, hot, mine, unassignedCount, todays] = await Promise.all([
    supabase.from("escalations").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("email_drafts").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", "HOT"),
    me
      ? supabase.from("conversations").select("id", { count: "exact", head: true }).eq("assigned_human", me.id)
      : Promise.resolve({ count: 0 }),
    supabase.from("appointments").select("id", { count: "exact", head: true }).is("agent_id", null).neq("status", "cancelled").gte("starts_at", now.toISOString()),
    (() => {
      let qb = supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .neq("status", "cancelled")
        .gte("starts_at", now.toISOString())
        .lt("starts_at", localMidnight(addDays(today, 1), tz));
      if (me) qb = qb.eq("agent_id", me.id);
      return qb;
    })(),
  ]);
  const rows: (AnswerItem & { n: number })[] = [
    { n: esc.count ?? 0, title: "Chats waiting for a person", href: "/dashboard/escalations?status=open", badge: { label: "Urgent", tone: "red" } },
    { n: hot.count ?? 0, title: "Hot leads to call", href: "/dashboard/leads?status=HOT", badge: { label: "Hot", tone: "red" } },
    { n: drafts.count ?? 0, title: "Emails waiting for your approval", href: "/dashboard/approvals", badge: { label: "Approve", tone: "amber" } },
    { n: mine.count ?? 0, title: "Chats you're handling", href: "/dashboard/inbox" },
    { n: unassignedCount.count ?? 0, title: "Upcoming viewings without an agent", href: "/dashboard/appointments?agent=none", badge: { label: "Assign", tone: "amber" } },
    { n: todays.count ?? 0, title: me ? "Your viewings still to come today" : "Viewings still to come today", href: "/dashboard/calendar" },
  ];
  const open = rows.filter((r) => r.n > 0);
  // Count what's waiting for action (the first four kinds), not chats you're
  // already in or the rest of today's viewings.
  const total = rows.slice(0, 4).reduce((s, r) => s + r.n, 0);
  return {
    text: total ? `${plural(total, "thing")} need${total === 1 ? "s" : ""} you right now.` : open.length ? "Nothing urgent is waiting for you." : "Nothing is waiting for you. All clear.",
    items: open.map(({ n, ...r }) => ({ ...r, meta: String(n) })),
    suggestions: ["Viewings today", "Hot leads", "How many leads this week?"],
  };
}

// ── Counts (with a short list) ──

async function count(entity: Entity, range: Range | null, status: string | undefined, booked: boolean, list: boolean, ctx: Ctx): Promise<Answer> {
  const { supabase, tz } = ctx;
  const b = range ? bounds(range, tz) : null;
  const when = range ? ` ${range.label}` : "";
  const daysParam = range?.days ? `days=${range.days}` : range?.label === "today" ? "days=1" : range?.label === "this week" ? "days=7" : "";

  const table: Record<Entity, string> = {
    leads: "leads",
    conversations: "conversations",
    viewings: "appointments",
    escalations: "escalations",
    approvals: "email_drafts",
    listings: "listings",
    contacts: "contacts",
  };
  const columns: Record<Entity, string> = {
    leads: "id, status, created_at, contact:contacts(name, email, phone)",
    conversations: "id, channel, status, created_at, contact:contacts(name, email, phone)",
    viewings: "id, starts_at, status, contact:contacts(name, email, phone), listing:listings(title, district, city)",
    escalations: "id, reason, context_summary, status, created_at",
    approvals: "id, subject, to_email, created_at",
    listings: "id, title, price, currency, transaction_type, district, city, photos, image_url, url",
    contacts: "id, name, email, phone, created_at",
  };
  const timeCol = entity === "viewings" && !booked ? "starts_at" : "created_at";

  const build = (cols: string, head: boolean) => {
    let qb = supabase.from(table[entity]).select(cols, head ? { count: "exact", head: true } : { count: "exact" });
    if (b) qb = qb.gte(timeCol, b.from).lt(timeCol, b.to);
    if (entity === "leads" && status) qb = qb.eq("status", status);
    if (entity === "viewings") qb = qb.neq("status", "cancelled");
    if (entity === "escalations") qb = qb.eq("status", "open");
    if (entity === "approvals") qb = qb.eq("status", "pending");
    if (entity === "listings") qb = qb.eq("status", "available");
    return qb;
  };

  const { data, count: n, error } = await build(columns[entity], false)
    .order(timeCol === "starts_at" ? "starts_at" : entity === "listings" ? "updated_at" : "created_at", { ascending: timeCol === "starts_at" })
    .limit(6);
  if (error) return { text: `I couldn't look that up: ${error.message}` };
  const total = n ?? 0;

  const noun = ENTITY_NOUN[entity];
  const statusWord = status ? `${status.toLowerCase()} ` : "";
  const verb = entity === "viewings" ? (booked ? " booked" : "") : "";
  const text =
    entity === "viewings" && !booked
      ? `${plural(total, "viewing")}${when || " in total"}.`
      : `${total} ${statusWord}${total === 1 ? noun[0] : noun[1]}${verb}${when}.`;

  const rows = (data ?? []) as any[];
  const items: AnswerItem[] = rows.map((r) => {
    switch (entity) {
      case "leads":
        return { title: contactLabel(r.contact), subtitle: r.contact?.phone || r.contact?.email || undefined, meta: shortDate(r.created_at, tz), badge: LEAD_TONE[r.status], href: `/dashboard/leads?status=${r.status}` };
      case "conversations":
        return { title: contactLabel(r.contact, r.channel), subtitle: channelName(r.channel), meta: shortDate(r.created_at, tz), href: `/dashboard/conversations/${r.id}` };
      case "viewings":
        return {
          title: `${dayLabel(dayKey(r.starts_at, tz))}, ${timeOf(r.starts_at, tz)}`,
          subtitle: [contactLabel(r.contact), r.listing?.title].filter(Boolean).join(" · "),
          href: `/dashboard/appointments/${r.id}`,
        };
      case "escalations":
        return { title: humanizeReason(r.reason), subtitle: r.context_summary || undefined, meta: shortDate(r.created_at, tz), href: "/dashboard/escalations?status=open", badge: { label: "Open", tone: "red" } };
      case "approvals":
        return { title: r.subject || "(no subject)", subtitle: r.to_email ? `To ${r.to_email}` : undefined, meta: shortDate(r.created_at, tz), href: "/dashboard/approvals" };
      case "listings":
        return listingItem(r);
      case "contacts":
        return { title: contactLabel(r), subtitle: [r.email, r.phone].filter(Boolean).join(" · ") || undefined, meta: shortDate(r.created_at, tz) };
    }
  });

  const pages: Record<Entity, string> = {
    leads: "/dashboard/leads",
    conversations: "/dashboard/conversations",
    viewings: "/dashboard/appointments",
    escalations: "/dashboard/escalations?status=open",
    approvals: "/dashboard/approvals",
    listings: "/dashboard/listings?status=available",
    contacts: "/dashboard/leads",
  };
  const params = [daysParam, entity === "leads" && status ? `status=${status}` : ""].filter(Boolean).join("&");
  const base = pages[entity];
  const href = params ? `${base}${base.includes("?") ? "&" : "?"}${params}` : base;
  return {
    text,
    items: list || total <= 6 ? items : items.slice(0, 3),
    more: total > 0 ? { label: `See ${total === 1 ? "it" : `all ${total}`}`, href } : undefined,
  };
}

// ── Viewings in a range ──

async function schedule(range: Range, mine: boolean, ctx: Ctx): Promise<Answer> {
  const { supabase, tz, me } = ctx;
  const b = bounds(range, tz);
  const { data: team } = await supabase.from("tenant_users").select("id, full_name, email").is("removed_at", null);
  let qb = supabase
    .from("appointments")
    .select("id, starts_at, status, agent_id, contact:contacts(name, email, phone), listing:listings(title, address, district, city, photos, image_url), agent:tenant_users(full_name, email)")
    .neq("status", "cancelled")
    .gte("starts_at", b.from)
    .lt("starts_at", b.to)
    .order("starts_at")
    .limit(30);
  if (mine && me) qb = qb.eq("agent_id", me.id);
  const { data, error } = await qb;
  if (error) return { text: `I couldn't look that up: ${error.message}` };
  const rows = (data ?? []) as any[];
  const who = mine && me ? "You have" : "There";
  const verb = mine && me ? "" : rows.length === 1 ? " is" : " are";
  const text = rows.length ? `${who}${verb} ${plural(rows.length, "viewing")} ${range.label}.` : `No viewings ${range.label}${mine && me ? " for you" : ""}.`;
  const multiDay = range.to > addDays(range.from, 1);
  return {
    text,
    items: rows.slice(0, 10).map((a) => {
      const cover = a.listing ? listingPhotos(a.listing)[0] : undefined;
      return {
        title: `${multiDay ? `${dayLabel(dayKey(a.starts_at, tz))}, ` : ""}${timeOf(a.starts_at, tz)} · ${contactLabel(a.contact)}`,
        subtitle: [a.listing ? [a.listing.title, a.listing.address || a.listing.district].filter(Boolean).join(", ") : "Property not set", a.agent ? personName(a.agent) : "No agent yet"].join(" · "),
        image: cover ? resizedPhotoUrl(cover, 160) : undefined,
        href: `/dashboard/appointments/${a.id}`,
        badge: a.agent ? undefined : { label: "Unassigned", tone: "amber" as const },
      };
    }),
    more: { label: "Open the calendar", href: `/dashboard/calendar?week=${range.from}${mine && me ? "" : "&agent=all"}` },
    suggestions: (team ?? []).length > 1 && !mine ? ["My viewings this week", "Unassigned viewings"] : undefined,
  };
}

async function hotLeads({ supabase, tz }: Ctx): Promise<Answer> {
  const { data, count: n } = await supabase
    .from("leads")
    .select("id, updated_at, contact:contacts(name, email, phone), owner:tenant_users(full_name, email)", { count: "exact" })
    .eq("status", "HOT")
    .order("updated_at", { ascending: false })
    .limit(8);
  const rows = (data ?? []) as any[];
  return {
    text: rows.length ? `${plural(n ?? rows.length, "hot lead")} to call.` : "No hot leads right now.",
    items: rows.map((l) => ({
      title: contactLabel(l.contact),
      subtitle: [l.contact?.phone || l.contact?.email, l.owner ? personName(l.owner) : "No owner"].filter(Boolean).join(" · "),
      meta: shortDate(l.updated_at, tz),
      href: l.contact?.phone ? `tel:${String(l.contact.phone).replace(/\s/g, "")}` : "/dashboard/leads?status=HOT",
      badge: { label: "Hot", tone: "red" as const },
    })),
    more: rows.length ? { label: "All hot leads", href: "/dashboard/leads?status=HOT" } : undefined,
  };
}

async function unassigned({ supabase, tz, now }: Ctx): Promise<Answer> {
  const { data } = await supabase
    .from("appointments")
    .select("id, starts_at, contact:contacts(name, email, phone), listing:listings(title, district)")
    .is("agent_id", null)
    .neq("status", "cancelled")
    .gte("starts_at", now.toISOString())
    .order("starts_at")
    .limit(10);
  const rows = (data ?? []) as any[];
  return {
    text: rows.length ? `${plural(rows.length, "upcoming viewing")} without an agent.` : "Every upcoming viewing has an agent.",
    items: rows.map((a) => ({
      title: `${dayLabel(dayKey(a.starts_at, tz))}, ${timeOf(a.starts_at, tz)} · ${contactLabel(a.contact)}`,
      subtitle: a.listing ? [a.listing.title, a.listing.district].filter(Boolean).join(", ") : "Property not set",
      href: `/dashboard/appointments/${a.id}`,
      badge: { label: "Assign", tone: "amber" as const },
    })),
    more: rows.length ? { label: "See them in Appointments", href: "/dashboard/appointments?agent=none" } : undefined,
  };
}

// ── Listings ──

function listingItem(l: any): AnswerItem {
  const cover = listingPhotos(l)[0];
  return {
    title: l.title,
    subtitle: [formatPrice(l.price, l.currency, l.transaction_type), [l.district, l.city].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
    image: cover ? resizedPhotoUrl(cover, 160) : undefined,
    href: `/dashboard/listings/${l.id}`,
  };
}

export function describeFilters(f: ListingFilters, n = 2): string {
  const parts: string[] = [];
  if (f.rooms) parts.push(`${f.rooms}${f.roomsAtLeast ? "+" : ""}-room`);
  const noun: Record<string, [string, string]> = {
    house: ["house", "houses"],
    plot: ["plot", "plots"],
    commercial: ["commercial space", "commercial spaces"],
    apartment: ["flat", "flats"],
  };
  const [one, many] = noun[f.propertyType ?? ""] ?? ["listing", "listings"];
  parts.push(n === 1 ? one : many);
  if (f.transaction) parts.push(f.transaction === "rent" ? "for rent" : "for sale");
  if (f.location) parts.push(`in ${f.location}`);
  const fmt = (n: number) => n.toLocaleString("en-GB").replace(/,/g, " ");
  if (f.minPrice && f.maxPrice) parts.push(`between ${fmt(f.minPrice)} and ${fmt(f.maxPrice)}`);
  else if (f.maxPrice) parts.push(`up to ${fmt(f.maxPrice)}`);
  else if (f.minPrice) parts.push(`from ${fmt(f.minPrice)}`);
  return parts.join(" ");
}

async function listings(f: ListingFilters, { supabase }: Ctx): Promise<Answer> {
  let qb = supabase
    .from("listings")
    .select("id, title, price, currency, transaction_type, district, city, rooms, photos, image_url, url", { count: "exact" })
    .eq("status", "available");
  if (f.location) {
    const like = `%${placeStem(f.location).replace(/[%,()]/g, " ")}%`;
    qb = qb.or(`district.ilike.${like},city.ilike.${like},address.ilike.${like},title.ilike.${like}`);
  }
  if (f.maxPrice) qb = qb.lte("price", f.maxPrice);
  if (f.minPrice) qb = qb.gte("price", f.minPrice);
  if (f.rooms) qb = f.roomsAtLeast ? qb.gte("rooms", f.rooms) : qb.eq("rooms", f.rooms);
  if (f.transaction) qb = qb.eq("transaction_type", f.transaction);
  if (f.propertyType) qb = qb.eq("property_type", f.propertyType);
  const { data, count: n, error } = await qb.order("price", { ascending: true, nullsFirst: false }).limit(8);
  if (error) return { text: `I couldn't search the listings: ${error.message}` };
  const total = n ?? 0;
  const what = describeFilters(f, total);
  const params = new URLSearchParams({ status: "available" });
  if (f.location) params.set("q", f.location);
  if (f.transaction) params.set("type", f.transaction);
  return {
    text: total ? `${total} available ${what}${total > 8 ? ", cheapest first" : ""}.` : `No available ${what}.`,
    items: ((data ?? []) as any[]).map(listingItem),
    more: total ? { label: `Open in Listings`, href: `/dashboard/listings?${params}` } : undefined,
    suggestions: total ? undefined : ["How many listings do we have?"],
  };
}

// ── People ──

async function people(query: string, { supabase, tz }: Ctx): Promise<Answer> {
  const clean = query.replace(/[%,()]/g, " ").trim();
  const digits = clean.replace(/\D/g, "");
  const ors = [`name.ilike.%${clean}%`, `email.ilike.%${clean}%`];
  if (digits.length >= 6) ors.push(`phone.ilike.%${digits.slice(-9)}%`);
  // "Anna Kowalska" also finds "Kowalska Anna".
  const words = clean.split(/\s+/).filter((w) => w.length > 1);
  if (words.length > 1) ors.push(`name.ilike.%${words[words.length - 1]}%`);
  const { data, error } = await supabase.from("contacts").select("id, name, email, phone, created_at").or(ors.join(",")).limit(6);
  if (error) return { text: `I couldn't search contacts: ${error.message}` };
  let rows = (data ?? []) as any[];
  if (words.length > 1) {
    const all = words.map((w) => fold(w));
    const full = rows.filter((r) => all.every((w) => fold(`${r.name ?? ""} ${r.email ?? ""}`).includes(w)));
    if (full.length) rows = full;
  }
  if (!rows.length) return { text: `I couldn't find anyone matching "${query}".`, suggestions: ["Hot leads", "How many leads this week?"] };

  const ids = rows.map((r) => r.id);
  const [{ data: leadRows }, { data: convRows }, { data: apptRows }] = await Promise.all([
    supabase.from("leads").select("contact_id, status, updated_at").in("contact_id", ids).order("updated_at", { ascending: false }),
    supabase.from("conversations").select("id, contact_id, channel, created_at").in("contact_id", ids).order("created_at", { ascending: false }),
    supabase.from("appointments").select("id, contact_id, starts_at").in("contact_id", ids).neq("status", "cancelled").gte("starts_at", new Date().toISOString()).order("starts_at"),
  ]);
  const first = <T extends { contact_id: string }>(list: T[] | null, id: string) => (list ?? []).find((x) => x.contact_id === id);

  return {
    text: rows.length === 1 ? `Here's ${contactLabel(rows[0])}.` : `${rows.length} people match "${query}".`,
    items: rows.map((c) => {
      const lead = first(leadRows as any[], c.id) as any;
      const conv = first(convRows as any[], c.id) as any;
      const next = first(apptRows as any[], c.id) as any;
      return {
        title: contactLabel(c),
        subtitle: [c.email, c.phone, next ? `viewing ${dayLabel(dayKey(next.starts_at, tz))} ${timeOf(next.starts_at, tz)}` : null].filter(Boolean).join(" · ") || undefined,
        badge: lead ? LEAD_TONE[lead.status] : undefined,
        href: next ? `/dashboard/appointments/${next.id}` : conv ? `/dashboard/conversations/${conv.id}` : lead ? `/dashboard/leads?status=${lead.status}` : undefined,
        meta: conv ? channelName(conv.channel) : undefined,
      };
    }),
  };
}

// ── Anything else: look for it in people and listings ──

async function search(query: string, ctx: Ctx): Promise<Answer> {
  const clean = query.replace(/[%,()]/g, " ").trim().slice(0, 80);
  if (clean.length < 2) return answer({ kind: "help" }, ctx);
  const like = `%${clean}%`;
  const [{ data: c }, { data: l }] = await Promise.all([
    ctx.supabase.from("contacts").select("id, name, email, phone").or(`name.ilike.${like},email.ilike.${like},phone.ilike.${like}`).limit(4),
    ctx.supabase
      .from("listings")
      .select("id, title, price, currency, transaction_type, district, city, photos, image_url, url")
      .or(`title.ilike.${like},reference.ilike.${like},district.ilike.${like},address.ilike.${like},description.ilike.${like}`)
      .limit(4),
  ]);
  const items: AnswerItem[] = [
    ...((c ?? []) as any[]).map((p) => ({ title: contactLabel(p), subtitle: [p.email, p.phone].filter(Boolean).join(" · ") || undefined, badge: { label: "Person", tone: "gray" as const } })),
    ...((l ?? []) as any[]).map((x) => ({ ...listingItem(x), badge: { label: "Listing", tone: "blue" as const } })),
  ];
  if (!items.length)
    return {
      text: `I'm not sure what you mean by "${query}". I can answer questions like these:`,
      suggestions: EXAMPLES.slice(0, 6),
    };
  return { text: `Here's what I found for "${query}".`, items };
}

// ── Small helpers ──

function shortDate(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: tz });
}

function channelName(c: string): string {
  return ({ chat_widget: "Website chat", whatsapp: "WhatsApp", email: "Email", sms: "SMS" } as Record<string, string>)[c] || c;
}

function humanizeReason(r: string): string {
  const s = (r || "").replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export { DEFAULT_TZ };
