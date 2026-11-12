"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AlertTriangle, ArrowRight, CircleCheck, Hand } from "lucide-react";
import { Badge, StatusBadge, btn, timeAgo } from "../../../_ui/ui";

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
  customer_requested_human: "Customer asked for a person",
  angry_customer: "Angry customer",
  legal_issue: "Legal issue",
  refund_requested: "Refund requested",
  sensitive_info: "Sensitive information",
  no_trusted_source: "Elliot had no source to answer from",
  action_exceeds_permissions: "Needs a person's permission",
  other: "Other",
};

function formatDuration(startIso: string, endIso: string) {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return `${hours} h ${remMins} min`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${days} d ${remHours} h`;
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

  const isOpen = escalation.status === "open";
  const urgent = escalation.priority === "high" || escalation.priority === "urgent";

  const Icon = escalation.status === "resolved" ? CircleCheck : escalation.status === "acknowledged" ? Hand : AlertTriangle;
  const tile =
    escalation.status === "resolved"
      ? "bg-[#e3f6ea] text-[#1f6b40]"
      : escalation.status === "acknowledged"
        ? "gold-tile"
        : "bg-alert-soft text-alert-dark";

  return (
    <li className={`card flex flex-col p-5 ${isOpen ? "ring-1 ring-alert/25" : ""} ${escalation.status === "resolved" ? "opacity-85" : ""}`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${tile}`}>
          <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-[15.5px] font-semibold text-ink">{REASON_LABELS[escalation.reason] || escalation.reason}</h2>
            {urgent && <Badge tone="alert">{escalation.priority === "urgent" ? "Urgent" : "High priority"}</Badge>}
            <StatusBadge kind="escalation" value={escalation.status} />
          </div>
          <p className="m-0 mt-0.5 text-[12.5px] text-gray-500">
            {timeAgo(escalation.created_at)}
            {escalation.status === "resolved" && escalation.resolved_at
              ? `, resolved in ${formatDuration(escalation.created_at, escalation.resolved_at)}`
              : ""}
          </p>
        </div>
      </div>

      <p className="m-0 mt-3 rounded-2xl border border-[rgba(15,31,56,0.06)] bg-[#f3f6fb] px-4 py-3 text-[13.5px] leading-relaxed text-gray-800">
        {escalation.context_summary}
      </p>

      {error && (
        <p className="m-0 mt-3 text-[13px] text-alert" role="alert">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a href={`/dashboard/conversations/${escalation.conversation_id}`} className={`${btn.secondary} ${btn.small}`}>
          Open conversation <ArrowRight size={14} aria-hidden="true" />
        </a>
        {escalation.status !== "resolved" && (
          <span className="ml-auto flex flex-wrap gap-2">
            {isOpen && (
              <button type="button" onClick={() => updateStatus("acknowledged")} disabled={busy} className={`${btn.secondary} ${btn.small}`}>
                I&apos;ve got it
              </button>
            )}
            <button type="button" onClick={() => updateStatus("resolved")} disabled={busy} className={`${btn.primary} ${btn.small}`}>
              Mark resolved
            </button>
          </span>
        )}
      </div>
    </li>
  );
}
