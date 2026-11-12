// Short summaries for the Conversations and Leads lists: what a client is
// looking for (from the answers Elliot collected) and what happened in a
// conversation (from its status, bookings and drafts). Plain functions, so
// they can be tested without a database.

import { dayLabel, dayKey, timeOf } from "./appointments";

type Answers = Record<string, unknown> | null | undefined;

const text = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** "2-bed flat in Mokotów · up to 900k · within a month", or null when Elliot has nothing yet. */
export function lookingFor(answers: Answers): string | null {
  const a = answers || {};
  const valuation = a.valuation && typeof a.valuation === "object" ? (a.valuation as Record<string, unknown>) : null;
  if (valuation) {
    const where = text(valuation.address) || text(valuation.city);
    return ["Valuation", where].filter(Boolean).join(" · ") || null;
  }
  const what = text(a.property_type) || text(a.requirement);
  const budget = text(a.budget);
  const when = text(a.timeline);
  const parts = [what, budget, when].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export type ActivityTone = "ok" | "wait" | "alert" | "muted";

/** One line on what happened in a conversation, most important first. */
export function conversationActivity(c: {
  status: string;
  notClient?: boolean;
  handler?: string | null;
  booking?: { starts_at: string } | null;
  draftWaiting?: boolean;
  lastRole?: string | null;
  tz?: string;
}): { text: string; tone: ActivityTone } {
  if (c.notClient) return { text: "Not a client (spam or an automatic email)", tone: "muted" };
  if (c.booking) {
    const tz = c.tz;
    return { text: `Viewing booked ${dayLabel(dayKey(c.booking.starts_at, tz))} ${timeOf(c.booking.starts_at, tz)}`, tone: "ok" };
  }
  if (c.handler) return { text: `${c.handler} is handling it`, tone: "wait" };
  if (c.status === "escalated") return { text: "Handed to a person", tone: "alert" };
  if (c.draftWaiting) return { text: "Reply waiting for your approval", tone: "wait" };
  if (c.lastRole === "assistant") return { text: "Elliot replied", tone: "ok" };
  if (c.lastRole === "human_agent") return { text: "Your team replied", tone: "ok" };
  if (c.lastRole === "user") return { text: c.status === "closed" ? "Client wrote last" : "Waiting for a reply", tone: "muted" };
  return { text: "No messages yet", tone: "muted" };
}
