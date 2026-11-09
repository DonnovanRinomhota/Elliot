// WhatsApp rules the dashboard needs to know about.
//
// Meta only lets a business send a free-form message within 24 hours of the
// client's last message. After that, only a pre-approved template can be sent
// (not built yet), so a team member's reply is refused with a clear reason
// instead of failing at Meta.

export const WHATSAPP_WINDOW_HOURS = 24;
export const WHATSAPP_MAX_LENGTH = 4096;

export type WhatsappWindow = {
  open: boolean;
  /** When the window closes (or closed); null if the client never wrote. */
  closesAt: Date | null;
  /** Whole minutes left while open, 0 when closed. */
  minutesLeft: number;
};

export function whatsappWindow(lastInboundAt: string | Date | null | undefined, now: Date = new Date()): WhatsappWindow {
  const last = lastInboundAt ? new Date(lastInboundAt) : null;
  if (!last || Number.isNaN(last.getTime())) return { open: false, closesAt: null, minutesLeft: 0 };
  const closesAt = new Date(last.getTime() + WHATSAPP_WINDOW_HOURS * 3600_000);
  const msLeft = closesAt.getTime() - now.getTime();
  return { open: msLeft > 0, closesAt, minutesLeft: msLeft > 0 ? Math.floor(msLeft / 60_000) : 0 };
}

/** "3 h 20 min", "45 min" — how long a team member still has to reply. */
export function timeLeftLabel(minutes: number): string {
  if (minutes <= 0) return "0 min";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Why a reply can't be sent, or null when it can. */
export function whatsappReplyProblem(content: string, window: WhatsappWindow): string | null {
  const text = content.trim();
  if (!text) return "Write a message first.";
  if (text.length > WHATSAPP_MAX_LENGTH) return `WhatsApp messages can be at most ${WHATSAPP_MAX_LENGTH} characters.`;
  if (!window.open) {
    return window.closesAt
      ? "WhatsApp only allows replies within 24 hours of the client's last message. Wait for them to write again, or call or email them."
      : "The client hasn't written on WhatsApp yet, so you can't message them here.";
  }
  return null;
}
