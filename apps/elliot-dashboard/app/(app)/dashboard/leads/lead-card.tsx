"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Lead = {
  id: string;
  tenant_id: string;
  status: string;
  score: number | string | null;
  qualification_answers: Record<string, unknown> | null;
  created_at: string;
  contact: { name: string | null; email: string | null; phone: string | null } | null;
};

// Real values confirmed via leads_status_check constraint.
const STATUS_OPTIONS = ["NEW", "QUALIFYING", "HOT", "WARM", "COLD", "CONVERTED", "LOST"];
const CLOSED_STATUSES = ["CONVERTED", "LOST"];

const STATUS_STYLES: Record<string, string> = {
  HOT: "bg-coral-soft text-coral-dark",
  WARM: "bg-amber-soft text-amber-dark",
  COLD: "bg-gray-100 text-gray-600",
  NEW: "bg-blue-50 text-blue-700",
  QUALIFYING: "bg-blue-50 text-blue-700",
  CONVERTED: "bg-pulse-soft text-pulse-dark",
  LOST: "bg-gray-100 text-gray-500",
};

type ScoreReason = { label: string; points: number; met: boolean };

/** An active sequence with at least one step -- one a lead can be started on. */
export type StartableSequence = { id: string; name: string; firstDayOffset: number };
/** The lead's in-progress follow-up run, if any. */
export type RunningRun = { id: string; sequenceName: string };

// Mirrors 10-lead-capture.json's "Score Lead" node exactly (n8n workflow,
// not this app) so what's shown here always matches the real stored score.
// If that scoring logic ever changes, this needs to change with it --
// there's no shared source of truth between the two right now.
function computeScoreReasons(lead: Lead): ScoreReason[] {
  const answers = lead.qualification_answers || {};
  const budget = answers.budget as string | undefined;
  const timeline = answers.timeline as string | undefined;
  const propertyType = answers.property_type as string | undefined;
  const intentSignal = answers.intent_signal as string | undefined;
  const isUrgentTimeline = !!timeline && /\b(week|month|asap|now|soon)\b/i.test(timeline);

  return [
    { label: budget ? `Budget provided: ${budget}` : "Budget not yet provided", points: 25, met: !!budget },
    {
      label: isUrgentTimeline
        ? `Urgent timeline: ${timeline}`
        : timeline
          ? `Timeline given but not urgent: ${timeline}`
          : "Timeline not yet provided",
      points: 25,
      met: isUrgentTimeline,
    },
    {
      label: propertyType ? `Property type specified: ${propertyType}` : "Property type not yet specified",
      points: 15,
      met: !!propertyType,
    },
    {
      label: intentSignal ? `Intent signal: ${intentSignal}` : "No clear intent signal yet",
      points: 20,
      met: !!intentSignal,
    },
    { label: "Email provided", points: 10, met: !!lead.contact?.email },
    { label: "Phone provided", points: 5, met: !!lead.contact?.phone },
  ];
}

export default function LeadCard({
  lead,
  sequences,
  runningRun,
}: {
  lead: Lead;
  sequences: StartableSequence[];
  runningRun: RunningRun | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [sequenceId, setSequenceId] = useState(sequences[0]?.id ?? "");
  const hasEmail = !!lead.contact?.email?.trim();

  // Same row shape workflow 21 inserts: the sweep (20) picks it up from
  // next_run_at, and the "contact replied" stop check counts from now.
  async function startFollowUp() {
    const seq = sequences.find((s) => s.id === sequenceId);
    if (!seq) return;
    setBusy(true);
    setError(null);
    const nextRunAt = new Date(Date.now() + seq.firstDayOffset * 24 * 60 * 60 * 1000).toISOString();
    const { error: insertError } = await supabase.from("follow_up_runs").insert({
      tenant_id: lead.tenant_id,
      lead_id: lead.id,
      sequence_id: seq.id,
      current_step_index: 0,
      status: "running",
      next_run_at: nextRunAt,
    });
    setBusy(false);
    if (insertError) return setError(insertError.message);
    router.refresh();
  }

  async function stopFollowUp() {
    if (!runningRun) return;
    setBusy(true);
    setError(null);
    const { error: updateError } = await supabase
      .from("follow_up_runs")
      .update({ status: "stopped", stop_reason: "manually_stopped", next_run_at: null })
      .eq("id", runningRun.id)
      .eq("status", "running");
    setBusy(false);
    if (updateError) return setError(updateError.message);
    router.refresh();
  }
  const isClosed = CLOSED_STATUSES.includes(lead.status);
  const reasons = computeScoreReasons(lead);
  const metReasons = reasons.filter((r) => r.met);
  const openReasons = reasons.filter((r) => !r.met);

  async function updateStatus(newStatus: string) {
    setBusy(true);
    setError(null);

    const { error: updateError } = await supabase.from("leads").update({ status: newStatus }).eq("id", lead.id);

    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className={`rounded-xl border border-gray-200 bg-white p-5 ${isClosed ? "opacity-70" : ""}`}>
      <div className="mb-2 flex items-start justify-between">
        <div>
          <span className="font-medium">{lead.contact?.name || lead.contact?.email || "Unknown contact"}</span>
          <span className="ml-2 text-xs text-gray-400">
            {lead.contact?.email} {lead.contact?.phone ? `· ${lead.contact.phone}` : ""}
          </span>
        </div>
        <span className="text-xs text-gray-400">
          {new Date(lead.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </span>
      </div>

      <div className="mb-3 flex items-center gap-3 text-xs">
        <span className={`rounded-md px-2 py-0.5 font-medium ${STATUS_STYLES[lead.status] || "bg-gray-100 text-gray-600"}`}>
          {lead.status}
        </span>
        {lead.score != null && <span className="text-gray-500">Score: {lead.score}/100</span>}
      </div>

      {lead.qualification_answers && Object.keys(lead.qualification_answers).length > 0 && (
        <div className="mb-3 rounded-md bg-gray-50 p-3">
          {metReasons.length > 0 && (
            <ul className="mb-1.5 list-none space-y-1">
              {metReasons.map((r) => (
                <li key={r.label} className="flex items-start gap-1.5 text-xs text-gray-700">
                  <span className="mt-0.5 text-green-600">✓</span>
                  <span>
                    {r.label} <span className="text-gray-400">(+{r.points})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {openReasons.length > 0 && (
            <ul className="list-none space-y-1">
              {openReasons.map((r) => (
                <li key={r.label} className="flex items-start gap-1.5 text-xs text-gray-400">
                  <span className="mt-0.5">·</span>
                  <span>{r.label}</span>
                </li>
              ))}
            </ul>
          )}
          <button
            onClick={() => setShowRaw((v) => !v)}
            className="mt-2 text-[11px] font-medium text-gray-400 hover:text-gray-600"
          >
            {showRaw ? "Hide raw answers" : "View raw answers"}
          </button>
          {showRaw && (
            <pre className="mt-2 overflow-x-auto rounded-md bg-white p-2.5 text-xs">
              {JSON.stringify(lead.qualification_answers, null, 2)}
            </pre>
          )}
        </div>
      )}

      {!isClosed && (runningRun || sequences.length > 0) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-gray-100 px-3 py-2 text-xs">
          {runningRun ? (
            <>
              <span className="text-gray-600">
                In follow-up: <span className="font-medium text-gray-800">{runningRun.sequenceName}</span>
              </span>
              <button
                onClick={stopFollowUp}
                disabled={busy}
                className="rounded-md border border-gray-200 bg-white px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
              >
                Stop follow-up
              </button>
            </>
          ) : hasEmail ? (
            <>
              <label htmlFor={`seq-${lead.id}`} className="text-gray-600">
                Follow-up
              </label>
              <select
                id={`seq-${lead.id}`}
                value={sequenceId}
                onChange={(e) => setSequenceId(e.target.value)}
                disabled={busy}
                className="rounded-md border border-gray-300 bg-white px-2 py-1"
              >
                {sequences.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                onClick={startFollowUp}
                disabled={busy || !sequenceId}
                className="rounded-md bg-ink px-3 py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                Start follow-up
              </button>
            </>
          ) : (
            <span className="text-gray-400">No email address, so this lead can&apos;t get email follow-ups.</span>
          )}
        </div>
      )}

      {error && <p className="mb-2 text-xs text-red-700">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.filter((s) => s !== lead.status).map((s) => (
          <button
            key={s}
            onClick={() => updateStatus(s)}
            disabled={busy}
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50"
          >
            Mark {s}
          </button>
        ))}
      </div>
    </div>
  );
}
