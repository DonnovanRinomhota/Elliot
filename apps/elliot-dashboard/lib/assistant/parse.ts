// The built-in assistant's understanding of a question. No AI service: plain
// rules that turn "how many leads this week?" or "flats in Mokotów under 1m"
// into a structured intent, which lib/assistant/run.ts answers from the
// agency's own data. English, plus the common Polish words.
//
// Pure functions (no database, no React) so they're easy to test.

import { addDays, dayKey, DEFAULT_TZ, weekStart } from "@/lib/appointments";

export type Range = {
  /** First day, "YYYY-MM-DD" in the agency's time zone. */
  from: string;
  /** Day after the last day (exclusive). */
  to: string;
  /** "today", "this week", "the last 7 days"... */
  label: string;
  /** For "last N days" style ranges: N, so links can use the pages' ?days= filter. */
  days?: number;
};

export type Entity = "leads" | "conversations" | "viewings" | "escalations" | "approvals" | "listings" | "contacts";

export type ListingFilters = {
  location?: string;
  maxPrice?: number;
  minPrice?: number;
  rooms?: number;
  roomsAtLeast?: boolean;
  transaction?: "sale" | "rent";
  propertyType?: "apartment" | "house" | "plot" | "commercial" | "room";
};

export type Intent =
  | { kind: "help" }
  | { kind: "needs_me" }
  | { kind: "navigate"; href: string; label: string }
  | { kind: "count"; entity: Entity; range: Range | null; status?: string; booked?: boolean; list: boolean }
  | { kind: "schedule"; range: Range; mine: boolean }
  | { kind: "hot_leads" }
  | { kind: "unassigned" }
  | { kind: "listings"; filters: ListingFilters }
  | { kind: "person"; query: string }
  | { kind: "search"; query: string };

/** Lower case, Polish letters folded to plain ones, single spaces. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const has = (t: string, re: RegExp) => re.test(t);

// ── Dates ──

const WEEKDAYS: [RegExp, number][] = [
  [/\b(monday|mon|poniedzialek|poniedzialku)\b/, 1],
  [/\b(tuesday|tue|tues|wtorek|wtorku)\b/, 2],
  [/\b(wednesday|wed|sroda|srode|srody)\b/, 3],
  [/\b(thursday|thu|thurs|czwartek|czwartku)\b/, 4],
  [/\b(friday|fri|piatek|piatku)\b/, 5],
  [/\b(saturday|sat|sobota|sobote|soboty)\b/, 6],
  [/\b(sunday|sun|niedziela|niedziele|niedzieli)\b/, 0],
];

const WEEKDAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The time range a question mentions, or null if it doesn't mention one. */
export function parseRange(t: string, now: Date, tz = DEFAULT_TZ): Range | null {
  const today = dayKey(now, tz);
  const day = (k: string, label: string): Range => ({ from: k, to: addDays(k, 1), label });

  let m = t.match(/\b(?:last|past|previous|ostatnie|ostatnich)\s+(\d{1,3})\s+(?:days?|dni)\b/);
  if (m) {
    const n = Math.max(1, Math.min(365, Number(m[1])));
    return { from: addDays(today, -(n - 1)), to: addDays(today, 1), label: `the last ${n} days`, days: n };
  }
  if (has(t, /\b(today|tonight|dzis|dzisiaj)\b/)) return day(today, "today");
  if (has(t, /\b(tomorrow|tmrw|jutro)\b/)) return day(addDays(today, 1), "tomorrow");
  if (has(t, /\b(yesterday|wczoraj)\b/)) return day(addDays(today, -1), "yesterday");
  if (has(t, /\b(next week|w przyszlym tygodniu|przyszly tydzien)\b/)) {
    const s = addDays(weekStart(today), 7);
    return { from: s, to: addDays(s, 7), label: "next week" };
  }
  if (has(t, /\b(last week|previous week|w zeszlym tygodniu|zeszly tydzien|w poprzednim tygodniu)\b/)) {
    const s = addDays(weekStart(today), -7);
    return { from: s, to: addDays(s, 7), label: "last week" };
  }
  if (has(t, /\b(this week|w tym tygodniu|ten tydzien)\b/)) {
    const s = weekStart(today);
    return { from: s, to: addDays(s, 7), label: "this week" };
  }
  if (has(t, /\b(this weekend|weekend)\b/)) {
    const sat = addDays(weekStart(today), 5);
    return { from: sat, to: addDays(sat, 2), label: "this weekend" };
  }
  if (has(t, /\b(last month|previous month|w zeszlym miesiacu|w poprzednim miesiacu)\b/)) {
    const first = `${today.slice(0, 7)}-01`;
    const prevFirst = `${addDays(first, -1).slice(0, 7)}-01`;
    return { from: prevFirst, to: first, label: "last month" };
  }
  if (has(t, /\b(this month|w tym miesiacu)\b/)) {
    const first = `${today.slice(0, 7)}-01`;
    const next = addDays(first, 32).slice(0, 7) + "-01";
    return { from: first, to: next, label: "this month" };
  }
  for (const [re, dow] of WEEKDAYS) {
    if (re.test(t)) {
      const todayDow = new Date(`${today}T00:00:00Z`).getUTCDay();
      const k = addDays(today, (dow - todayDow + 7) % 7);
      return day(k, k === today ? "today" : `on ${WEEKDAY_NAME[dow]}`);
    }
  }
  return null;
}

// ── Money and rooms ──

/** "1m", "1.5 mln", "900k", "900 tys", "1 200 000", "2M PLN" -> number. */
export function parseAmount(raw: string): number | null {
  const m = raw
    .replace(/(\d)[  ](?=\d{3}\b)/g, "$1")
    .match(/(\d+(?:[.,]\d+)?)\s*(k|tys\.?|tysiecy|thousand|m|mln|million|milion(?:a|ow)?)?\b/);
  if (!m) return null;
  let n = Number(m[1].replace(",", "."));
  const unit = m[2] || "";
  if (/^(k|tys|tysiecy|thousand)/.test(unit)) n *= 1_000;
  else if (/^(m|mln|million|milion)/.test(unit)) n *= 1_000_000;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

const STOP =
  "(?=\\s+(?:under|below|over|above|between|priced|costing|from|for|with|up to|less than|more than|max|min|do|ponizej|powyzej|od|z|and|i|na|w|in|that|which|available|this|next|today|tomorrow)\\b|[,?.!]|$)";
// Words after "in" / "w" / "na" that aren't places.
const NOT_PLACES = /^(the|a|an|my|our|this|next|last|stock|total|rent|sale|wynajem|wynajmu|sprzedaz|sprzedazy|cenie|ofercie|okolicy)$|^(this|next|last) /;

/**
 * What to search for: Polish place names change their ending after "w"
 * ("w Wilanowie", "na Żoliborzu", "w Śródmieściu"), so search for the part
 * that stays the same. Short words are left alone.
 */
export function placeStem(place: string): string {
  const p = place.trim();
  const m = p.match(/^(.*?)(owie|iu|ie|u|i)$/i);
  return m && m[1].length >= 4 ? m[1] : p;
}

export function parseListingFilters(t: string, original: string): ListingFilters {
  const f: ListingFilters = {};

  const between = t.match(/\b(?:between|od)\s+((?:\d[\d\s.,]*)\s*(?:k|tys\.?|m|mln)?)\s+(?:and|do|-)\s+((?:\d[\d\s.,]*)\s*(?:k|tys\.?|m|mln)?)/);
  if (between) {
    f.minPrice = parseAmount(between[1]) ?? undefined;
    f.maxPrice = parseAmount(between[2]) ?? undefined;
    t = t.replace(between[0], " ");
  }

  const max = t.match(/\b(?:under|below|up to|less than|max(?:imum)?|cheaper than|do|ponizej|maks(?:ymalnie)?)\s+((?:\d[\d\s.,]*)\s*(?:k|tys\.?|m|mln|million|thousand)?)/);
  if (max) f.maxPrice = parseAmount(max[1]) ?? undefined;
  const min = t.match(/\b(?:over|above|more than|at least|from|min(?:imum)?|od|powyzej)\s+((?:\d[\d\s.,]*)\s*(?:k|tys\.?|m|mln|million|thousand)?)/);
  if (min) f.minPrice = parseAmount(min[1]) ?? undefined;

  const rooms = t.match(/\b(\d{1,2})\s*(\+)?\s*-?\s*(?:rooms?|bed(?:room)?s?|pok(?:oje|oi|ojowe|ojowy|\.)?)\b/);
  if (rooms) {
    f.rooms = Number(rooms[1]);
    if (rooms[2]) f.roomsAtLeast = true;
  }
  if (/\b(?:at least|min(?:imum)?|co najmniej)\s+\d{1,2}\s*(?:rooms?|bed|pok)/.test(t)) f.roomsAtLeast = true;

  if (/\b(rent|rental|rentals|to let|for let|lease|wynajem|wynajmu|wynajecia|najem)\b/.test(t)) f.transaction = "rent";
  else if (/\b(for sale|to buy|buy|sale|kupno|kupic|sprzedaz|na sprzedaz)\b/.test(t)) f.transaction = "sale";

  // No "rent" or "sale" said: the price tells. Nobody rents for 900k a month,
  // and nothing is for sale at 4,500.
  if (!f.transaction) {
    const price = f.maxPrice ?? f.minPrice;
    if (price != null && price >= 100_000) f.transaction = "sale";
    else if (price != null && price <= 30_000) f.transaction = "rent";
  }

  if (/\b(house|houses|dom|domy|domu)\b/.test(t)) f.propertyType = "house";
  else if (/\b(plot|plots|land|dzialka|dzialki)\b/.test(t)) f.propertyType = "plot";
  else if (/\b(office|offices|commercial|lokal|biuro|biura)\b/.test(t)) f.propertyType = "commercial";
  else if (/\b(flat|flats|apartment|apartments|studio|studios|penthouse|mieszkanie|mieszkania|kawalerka|apartament|apartamenty)\b/.test(t))
    f.propertyType = "apartment";

  // "in Mokotów", "w Wilanowie", "na Woli": keep the original spelling for the search.
  const candidates = Array.from(t.matchAll(new RegExp(`\\b(?:in|near|around|w|na)\\s+([a-z][a-z\\- ]{1,40}?)${STOP}`, "g")))
    .map((m) => m[1].trim())
    .filter((w) => !NOT_PLACES.test(w) && !parseRange(w, new Date()) && !/^\d/.test(w));
  const word = candidates[candidates.length - 1];
  if (word) {
    {
      // Same words in the original text (with Polish letters), if we can find them.
      const idx = fold(original).indexOf(word);
      f.location = idx >= 0 ? original.slice(idx, idx + word.length) : word;
    }
  }
  return f;
}

// ── Navigation ──

const PAGES: [RegExp, string, string][] = [
  [/^(overview|home|dashboard|start|pulpit)$/, "/", "Overview"],
  [/^(inbox|skrzynka)$/, "/dashboard/inbox", "Inbox"],
  [/^(escalations?|eskalacje)$/, "/dashboard/escalations", "Escalations"],
  [/^(approvals?|emails? to approve|zatwierdzenia)$/, "/dashboard/approvals", "Approvals"],
  [/^(leads?|leady)$/, "/dashboard/leads", "Leads"],
  [/^(appointments?|viewings?|wizyty|spotkania)$/, "/dashboard/appointments", "Appointments"],
  [/^(calendar|my calendar|kalendarz)$/, "/dashboard/calendar", "Calendar"],
  [/^(conversations?|chats?|rozmowy)$/, "/dashboard/conversations", "Conversations"],
  [/^(follow-?ups?)$/, "/dashboard/follow-ups", "Follow-ups"],
  [/^(listings?|properties|oferty)$/, "/dashboard/listings", "Listings"],
  [/^(knowledge(?: base)?|faq|baza wiedzy)$/, "/dashboard/knowledge", "Knowledge base"],
  [/^(team|zespol)$/, "/dashboard/team", "Team"],
  [/^(settings|ustawienia)$/, "/dashboard/settings", "Settings"],
  [/^(control panel|platform)$/, "/platform", "Control panel"],
  [/^(import(?: listings)?)$/, "/dashboard/listings/import", "Import listings"],
  [/^(add (?:a )?listing|new listing)$/, "/dashboard/listings/new", "Add listing"],
];

export function pageFor(word: string): { href: string; label: string } | null {
  const w = word.replace(/^the\s+/, "").replace(/\s+page$/, "").trim();
  for (const [re, href, label] of PAGES) if (re.test(w)) return { href, label };
  return null;
}

// ── The question ──

const ENTITY_WORDS: [Entity, RegExp][] = [
  ["viewings", /\b(viewings?|showings?|appointments?|visits?|bookings?|wizyt[ay]?|ogladan\w*|prezentacj\w*|spotkan\w*)\b/],
  ["leads", /\b(leads?|lead[oy]w?|leady|prospects?)\b/],
  ["conversations", /\b(conversations?|chats?|messages?|rozmow\w*|czat\w*)\b/],
  ["escalations", /\b(escalations?|handovers?|eskalacj\w*)\b/],
  ["approvals", /\b(approvals?|drafts?|emails? (?:to|waiting)|zatwierdz\w*)\b/],
  ["listings", /\b(listings?|propert(?:y|ies)|flats?|apartments?|houses?|ofert\w*|mieszka\w*|nieruchomosc\w*)\b/],
  ["contacts", /\b(contacts?|clients?|customers?|people|kontakt\w*|klien\w*)\b/],
];

const LEAD_STATUS: [RegExp, string][] = [
  [/\bhot\b|\bgoracy|\bgorace/, "HOT"],
  [/\bwarm\b|\bciepl/, "WARM"],
  [/\bcold\b|\bzimn/, "COLD"],
  [/\bnew\b|\bnowy|\bnowe|\bnowych/, "NEW"],
  [/\bqualifying\b/, "QUALIFYING"],
  [/\bconverted\b|\bwon\b|\bclosed\b/, "CONVERTED"],
  [/\blost\b|\butracon/, "LOST"],
];

export function parseQuestion(question: string, now = new Date(), tz = DEFAULT_TZ): Intent {
  const original = question.trim();
  const t = fold(original).replace(/[?!.]+$/, "");
  if (!t || /^(help|\?|what can you do|what can i ask|pomoc|co umiesz)\b/.test(t)) return { kind: "help" };

  // "open settings", "go to the calendar", "otworz leady"
  const nav = t.match(/^(?:open|go to|goto|take me to|show me the|navigate to|otworz|przejdz do|pokaz strone)\s+(.+)$/);
  if (nav) {
    const page = pageFor(nav[1]);
    if (page) return { kind: "navigate", ...page };
  }
  const bare = pageFor(t);
  if (bare && !/^(leads?|viewings?|appointments?|listings?|chats?|conversations?)$/.test(t)) return { kind: "navigate", ...bare };

  if (/\b(needs? (?:me|my attention|attention)|waiting (?:on|for) me|what(?:'s| is) waiting|to-?do|what should i do|my tasks|co czeka|co mam zrobic|do zrobienia)\b/.test(t))
    return { kind: "needs_me" };

  const asksCount = /\b(how many|number of|count|total|ile|liczba)\b/.test(t);
  const range = parseRange(t, now, tz);

  // People: emails, phone numbers, "who is ...", "find ..."
  const email = original.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  if (email) return { kind: "person", query: email[0] };
  const phone = original.match(/\+?\d[\d\s-]{5,}\d/);
  if (phone && !/\b(k|m|mln|tys|pln|zl|eur|usd)\b/.test(t) && !/\b(under|below|over|do|od)\b/.test(t))
    return { kind: "person", query: phone[0].replace(/[\s-]/g, "") };
  const who = original.match(/^\s*(?:who is|who's|find|search for|look up|lookup|contact|kto to|kim jest|znajdz|szukaj)\s+(.+?)\s*\??$/i);
  if (who) {
    const q = who[1].trim();
    const aboutSomethingElse = /\b(flat|apartment|house|listing|room|mieszkan|dom|ofert|pokoj|viewing|showing|appointment|visit|ogladan|wizyt)/i.test(fold(q));
    if (!aboutSomethingElse) return { kind: "person", query: q };
  }

  if (/\b(unassigned|no agent|without (?:an )?agent|nobody assigned|bez agenta|nieprzypisan\w*)\b/.test(t)) return { kind: "unassigned" };

  const entity = ENTITY_WORDS.find(([, re]) => re.test(t))?.[0];

  if (entity === "viewings" && !asksCount) {
    const mine = /\b(my|me|i have|do i|am i|moje|mam|moich)\b/.test(t);
    return {
      kind: "schedule",
      mine,
      range: range ?? { from: dayKey(now, tz), to: addDays(dayKey(now, tz), 7), label: "in the next 7 days" },
    };
  }

  if (/\bhot\b|\bgorac/.test(t) && !asksCount && (entity === "leads" || !entity)) return { kind: "hot_leads" };

  const listingFilters = parseListingFilters(t, original);
  const looksLikeListingSearch =
    entity === "listings" ||
    listingFilters.maxPrice != null ||
    listingFilters.minPrice != null ||
    listingFilters.rooms != null ||
    (listingFilters.propertyType != null && !entity);
  if (looksLikeListingSearch && !(asksCount && entity === "listings" && Object.keys(listingFilters).length === 0)) {
    if (!asksCount || Object.keys(listingFilters).length > 0) return { kind: "listings", filters: listingFilters };
  }

  if (entity) {
    const status = entity === "leads" ? LEAD_STATUS.find(([re]) => re.test(t))?.[1] : undefined;
    const booked = entity === "viewings" && /\b(booked|made|created|zarezerwowan\w*|umowion\w*)\b/.test(t);
    return { kind: "count", entity, range, status, booked, list: !asksCount };
  }

  // A name on its own ("Anna Kowalska") is most likely a person.
  if (/^\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+){0,2}$/u.test(original) && !range) return { kind: "person", query: original };

  return { kind: "search", query: original };
}

export const EXAMPLES = [
  "What needs me today?",
  "Viewings tomorrow",
  "How many leads this week?",
  "Hot leads",
  "Flats in Mokotów under 1m",
  "2 rooms for rent",
  "Who is Anna Kowalska?",
  "Unassigned viewings",
  "Chats in the last 30 days",
  "Open calendar",
];
