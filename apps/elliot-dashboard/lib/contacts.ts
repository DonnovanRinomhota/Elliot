// How a person is shown in the dashboard, and small helpers for their details.
// Plain functions, shared by server pages, client components and tests.

export type ContactLike = { name?: string | null; email?: string | null; phone?: string | null } | null | undefined;

const CHANNEL_PERSON: Record<string, string> = {
  chat_widget: "Website visitor",
  whatsapp: "WhatsApp contact",
  email: "Email sender",
  sms: "SMS contact",
};

/** Name, else email, else phone, else what we know from the channel. Never "Unknown contact". */
export function contactLabel(contact: ContactLike, channel?: string | null): string {
  const pick = (v?: string | null) => (v && v.trim() ? v.trim() : "");
  return (
    pick(contact?.name) ||
    pick(contact?.email) ||
    pick(contact?.phone) ||
    (channel ? CHANNEL_PERSON[channel] : "") ||
    "No name given"
  );
}

/** True when we have a name and a way to reach them. */
export function isIdentified(contact: ContactLike): boolean {
  return Boolean(contact?.name?.trim() && (contact?.email?.trim() || contact?.phone?.trim()));
}

export function cleanEmail(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : "invalid";
}

export function cleanPhone(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  return v.replace(/\D/g, "").length >= 6 ? v : "invalid";
}

/**
 * Hides repeated copies of the same visitor message saved within a few
 * seconds of each other (an old workflow bug saved some messages several
 * times; migration 0031 removes them from the database too).
 */
export function withoutRepeats<T extends { role: string; content: string; created_at: string }>(messages: T[], seconds = 10): T[] {
  const out: T[] = [];
  for (const m of messages) {
    const prev = [...out].reverse().find((p) => p.role === "user");
    const repeat =
      m.role === "user" &&
      prev &&
      prev.content === m.content &&
      Math.abs(new Date(m.created_at).getTime() - new Date(prev.created_at).getTime()) < seconds * 1000 &&
      out[out.length - 1] === prev;
    if (!repeat) out.push(m);
  }
  return out;
}
