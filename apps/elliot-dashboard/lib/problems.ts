// The control panel's Problems page (0050): every failure Elliot recorded,
// across agencies, in plain words, with what to do about it. Reads audit_log
// rows whose event ends in _failed, plus workflow crashes (workflow 34) and
// emails that reached no agency. Pure, so lib/problems.test.ts can test it.

export const PROBLEM_FILTER = "event_type.like.%_failed,event_type.eq.workflow_error,event_type.eq.email_unmatched_mailbox";

type Kind = { what: string; fix: string };

const KINDS: Record<string, Kind> = {
  email_send_failed: { what: "An email reply to a client couldn't be sent", fix: "Check Resend (domain, API key) and the agency's sending address in Settings → Email." },
  whatsapp_send_failed: { what: "A WhatsApp reply to a client couldn't be sent", fix: "Check the WhatsApp token in n8n, and whether the client wrote in the last 24 hours." },
  chat_send_failed: { what: "A website chat reply couldn't be sent", fix: "Look at workflow 01's run in n8n → Executions." },
  email_elliot_failed: { what: "Elliot couldn't answer an email", fix: "The client got a holding reply and the team an escalation. Check Claude's status and credit, then reply to the client." },
  whatsapp_elliot_failed: { what: "Elliot couldn't answer a WhatsApp message", fix: "The client got a holding reply and the team an escalation. Check Claude's status and credit." },
  chat_elliot_failed: { what: "Elliot couldn't answer a website chat", fix: "The visitor got a holding reply and the team an escalation. Check Claude's status and credit." },
  booking_failed: { what: "A viewing couldn't be booked", fix: "Usually Google refused: check the agent's calendar access (Team page → Check access). The client was told the team will follow up." },
  tool_failed: { what: "One of Elliot's actions failed", fix: "Elliot handed the conversation to the team. The detail shows which action; check that workflow's run in n8n." },
  whatsapp_delivery_failed: { what: "WhatsApp accepted a message but couldn't deliver it", fix: "Often the number isn't on WhatsApp or the 24-hour window had closed. Reach the client another way." },
  whatsapp_unanswered_failed: { what: "WhatsApp sent several messages at once; only the first was answered", fix: "Read that conversation and answer the rest yourself." },
  reminder_failed: { what: "A viewing reminder couldn't be sent", fix: "Check the client's email or WhatsApp, and Resend / the WhatsApp token." },
  workflow_error: { what: "A workflow crashed", fix: "Open that workflow's failed run in n8n → Executions; the detail names the node." },
  email_unmatched_mailbox: { what: "An email arrived for an address no agency owns", fix: "A forwarding address that's mistyped or an agency that was removed. Check Settings → Email." },
};

export function describeProblem(eventType: string): Kind {
  return (
    KINDS[eventType] ?? {
      what: eventType.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
      fix: "See the detail, and the matching run in n8n → Executions.",
    }
  );
}

/** The most useful single line from an audit_log details object. */
export function problemDetail(details: unknown): string {
  if (!details || typeof details !== "object") return "";
  const d = details as Record<string, unknown>;
  const pick = (...keys: string[]) => keys.map((k) => d[k]).find((v) => typeof v === "string" && v.trim()) as string | undefined;
  const error = pick("error", "message", "reason");
  const parts = [
    pick("tool"),
    // workflow_error's error already starts with "workflow / node:".
    error ? undefined : pick("workflow", "workflow_name"),
    error ? undefined : pick("node", "node_name"),
    error,
    typeof d.messages_not_answered === "number" ? `${d.messages_not_answered} not answered` : undefined,
  ].filter(Boolean) as string[];
  return parts.join(" · ").slice(0, 300);
}

/** Problems grouped by kind for the summary at the top: most frequent first. */
export function groupProblems<T extends { event_type: string }>(rows: T[]): { event_type: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.event_type, (counts.get(r.event_type) ?? 0) + 1);
  return [...counts.entries()].map(([event_type, count]) => ({ event_type, count })).sort((a, b) => b.count - a.count || a.event_type.localeCompare(b.event_type));
}
