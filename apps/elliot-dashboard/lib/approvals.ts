// What each card in Approvals shows besides the draft: when the client's
// message came in, when Elliot drafted the reply, and when it was sent,
// approved or rejected -- plus the client's own message, so you can judge
// the reply without opening the conversation.

export type DraftTimes = {
  status: string;
  created_at: string;
  sent_at?: string | null;
  reviewed_at?: string | null;
};

export type InboundMessage = { conversation_id: string; content: string; created_at: string };

/** "9 Nov 2026, 17:01" in the agency's time zone. */
export function stamp(iso: string, tz: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The steps of a draft, oldest first, e.g.
 * [["Received", "9 Nov 2026, 17:01"], ["Drafted", "9 Nov 2026, 17:02"], ["Sent", "9 Nov 2026, 17:05"]].
 */
export function draftTimeline(d: DraftTimes, tz: string, receivedAt?: string | null): [string, string][] {
  const steps: [string, string][] = [];
  if (receivedAt) steps.push(["Received", stamp(receivedAt, tz)]);
  steps.push(["Drafted", stamp(d.created_at, tz)]);
  if (d.status === "rejected" && d.reviewed_at) steps.push(["Rejected", stamp(d.reviewed_at, tz)]);
  else if (d.status === "approved" && d.reviewed_at && !d.sent_at) steps.push(["Approved, sending", stamp(d.reviewed_at, tz)]);
  if (d.sent_at) steps.push([d.status === "auto_sent" ? "Sent automatically" : "Sent", stamp(d.sent_at, tz)]);
  return steps;
}

/**
 * The client's message a draft answers: their latest message in the same
 * conversation from before the draft was made (a minute's leeway for clocks).
 */
export function inboundFor(
  draft: { conversation_id?: string | null; created_at: string },
  messages: InboundMessage[]
): InboundMessage | null {
  if (!draft.conversation_id) return null;
  const limit = new Date(draft.created_at).getTime() + 60_000;
  let best: InboundMessage | null = null;
  for (const m of messages) {
    if (m.conversation_id !== draft.conversation_id) continue;
    const t = new Date(m.created_at).getTime();
    if (t <= limit && (!best || t > new Date(best.created_at).getTime())) best = m;
  }
  return best;
}
