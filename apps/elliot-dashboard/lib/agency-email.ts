// The agency's email set-up (0039): the Elliot address its inbox forwards
// to, who clients see emails from, and whether forwarding is working.
// Keep the domains in step with elliot_email_domain() in the database.

export const INBOUND_DOMAIN = "in.getelliot.eu";
export const SENDING_DOMAIN = "mail.getelliot.eu";

export function inboundAddress(slug: string): string {
  return `${slug.trim().toLowerCase()}@${INBOUND_DOMAIN}`;
}

export function isEmail(v: string | null | undefined): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? "").trim());
}

/** What clients see: `"Simon Real Estate" <simon@mail.getelliot.eu>`, and where their replies go. */
export function senderPreview(opts: {
  slug: string;
  agencyName: string;
  fromName?: string | null;
  ownFromAddress?: string | null;
  agencyEmail?: string | null;
}): { from: string; replyTo: string } {
  const name = (opts.fromName ?? "").trim() || opts.agencyName;
  const address = (opts.ownFromAddress ?? "").trim() || `${opts.slug}@${SENDING_DOMAIN}`;
  const agency = (opts.agencyEmail ?? "").trim().toLowerCase();
  return { from: `${name} <${address}>`, replyTo: isEmail(agency) ? agency : inboundAddress(opts.slug) };
}

export type ForwardingStatus = { tone: "ok" | "waiting" | "quiet"; label: string };

/** Whether forwarded email is reaching Elliot. */
export function forwardingStatus(lastAt: string | null | undefined, lastFrom: string | null | undefined, now = new Date()): ForwardingStatus {
  if (!lastAt) return { tone: "waiting", label: "No email has reached Elliot through this address yet." };
  const when = new Date(lastAt);
  const days = (now.getTime() - when.getTime()) / 86400000;
  const ago = days < 1 / 24 ? "less than an hour ago" : days < 1 ? `${Math.floor(days * 24)} h ago` : `${Math.floor(days)} day${Math.floor(days) === 1 ? "" : "s"} ago`;
  const from = lastFrom ? ` from ${lastFrom}` : "";
  return days > 14
    ? { tone: "quiet", label: `Last email arrived ${ago}${from}. If your inbox gets enquiries every week, check the forward is still on.` }
    : { tone: "ok", label: `Working. Last email arrived ${ago}${from}.` };
}

/** Gmail's confirmation code, shown for a week after it arrives. */
export function forwardingCode(code: string | null | undefined, at: string | null | undefined, now = new Date()): string | null {
  if (!code || !at) return null;
  return now.getTime() - new Date(at).getTime() < 7 * 86400000 ? code : null;
}
