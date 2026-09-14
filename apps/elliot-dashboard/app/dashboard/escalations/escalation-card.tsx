"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Escalation = {
  id: string;
  conversation_id: string;
  reason: string;
  priority: string;
  context_summary: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
};

// Matches escalations' check constraints exactly (see 0006_escalations_crm_sync.sql).
const REASON_LABELS: Record<string, string> = {
  low_confidence: "Low confidence",
  customer_requested_human: "Customer requested human",
  angry_customer: "Angry customer",
  legal_issue: "Legal issue",
  refund_requested: "Refund requested",
  sensitive_info: "Sensitive info",
  no_trusted_source: "No trusted source",
  action_exceeds_permissions: "Action exceeds permissions",
  other: "Other",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "#999",
  normal: "#666",
  high: "#c2410c",
  urgent: "#dc2626",
};

function formatDuration(startIso: string, endIso: string) {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return `${hours}h ${remMins}m`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${days}d ${remHours}h`;
}

export default function EscalationCard({ escalation }: { escalation: Escalation }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function updateStatus(newStatus: string) {
    setBusy(true);
    setError(null);

    const updates: Record<string, unknown> = { status: newStatus };
    if (newStatus === "resolved") {
      updates.resolved_at = new Date().toISOString();
    }

    const { error: updateError } = await supabase.from("escalations").update(updates).eq("id", escalation.id);

    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.refresh();
  }

  return (
    <div style={{ background: "white", border: "1px solid #eee", borderRadius: 10, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <div>
          <strong>{REASON_LABELS[escalation.reason] || escalation.reason}</strong>
          <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: PRIORITY_COLORS[escalation.priority] || "#666" }}>
            {escalation.priority?.toUpperCase()}
          </span>
        </div>
        <span style={{ fontSize: 12, color: "#999" }}>
          {new Date(escalation.created_at).toLocaleString("en-GB", { timeZone: "UTC" })}
        </span>
      </div>

      <p style={{ fontSize: 14, color: "#333", marginBottom: 12 }}>{escalation.context_summary}</p>

      <div style={{ display: "flex", gap: 16, fontSize: 13, color: "#666", marginBottom: 12 }}>
        <span>
          Status: <strong>{escalation.status}</strong>
        </span>
        {escalation.status === "resolved" && escalation.resolved_at && (
          <span>
            Resolved in <strong>{formatDuration(escalation.created_at, escalation.resolved_at)}</strong>
          </span>
        )}
        <a href={`/dashboard/conversations/${escalation.conversation_id}`} style={{ color: "#2563eb" }}>
          View conversation →
        </a>
      </div>

      {error && <p style={{ color: "crimson", fontSize: 13, marginBottom: 8 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {escalation.status === "open" && (
          <button
            onClick={() => updateStatus("acknowledged")}
            disabled={busy}
            style={{ padding: "6px 12px", background: "white", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, cursor: "pointer" }}
          >
            Acknowledge
          </button>
        )}
        {escalation.status !== "resolved" && (
          <button
            onClick={() => updateStatus("resolved")}
            disabled={busy}
            style={{ padding: "6px 12px", background: "white", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, cursor: "pointer" }}
          >
            Mark resolved
          </button>
        )}
      </div>
    </div>
  );
}
