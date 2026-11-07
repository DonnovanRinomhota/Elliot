"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { btn, humanize, formatDate } from "../../../_ui/ui";
import { LEAD_GRID } from "./grid";
import { contactLabel } from "@/lib/contacts";

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

// The stage control's own colour follows the same rules as everywhere else:
// hot = alert, warm = brass, converted = ink, the rest neutral.
const STAGE_CONTROL: Record<string, string> = {
  HOT: "border-alert/40 bg-alert-soft text-alert-dark",
  WARM: "border-brass/40 bg-brass-soft text-brass-dark",
  CONVERTED: "border-accent/30 bg-accent-soft text-accent-dark",
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
    { label: budget ? `Budget: ${budget}` : "Budget not given yet", points: 25, met: !!budget },
    {
      label: isUrgentTimeline
        ? `Timeline: ${timeline}`
        : timeline
          ? `Timeline given, not urgent: ${timeline}`
          : "Timeline not given yet",
      points: 25,
      met: isUrgentTimeline,
    },
    {
      label: propertyType ? `Looking for: ${propertyType}` : "Property type not given yet",
      points: 15,
      met: !!propertyType,
    },
    {
      label: intentSignal ? `Intent: ${intentSignal}` : "No clear intent yet",
      points: 20,
      met: !!intentSignal,
    },
    { label: "Email address given", points: 10, met: !!lead.contact?.email },
    { label: "Phone number given", points: 5, met: !!lead.contact?.phone },
  ];
}


export default function LeadCard({
  lead,
  number,
  sequences,
  runningRun,
}: {
  /** Position in the list (1, 2, 3...), shown in the first column. */
  number?: number;
  lead: Lead;
  sequences: StartableSequence[];
  runningRun: RunningRun | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [sequenceId, setSequenceId] = useState(sequences[0]?.id ?? "");
  const hasEmail = !!lead.contact?.email?.trim();
  const isClosed = CLOSED_STATUSES.includes(lead.status);
  const reasons = computeScoreReasons(lead);
  const hasAnswers = !!lead.qualification_answers && Object.keys(lead.qualification_answers).length > 0;
  const name = contactLabel(lead.contact);
  const detailsId = `lead-details-${lead.id}`;

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

  async function updateStatus(newStatus: string) {
    if (newStatus === lead.status) return;
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

  const followUpText = runningRun
    ? runningRun.sequenceName
    : isClosed
      ? "Not needed"
      : !hasEmail
        ? "No email address"
        : "None";

  return (
    <li className="border-t border-gray-200 first:border-t-0">
      <div className={`grid gap-2 px-5 py-3.5 ${LEAD_GRID}`}>
        <span className="tabular hidden text-[12.5px] text-gray-400 md:block">{number}</span>
        <div className="min-w-0">
          <div className={`truncate text-[14px] font-medium ${isClosed ? "text-gray-500" : "text-ink"}`}>{name}</div>
          <div className="truncate text-[12.5px] text-gray-500">
            {[lead.contact?.name ? lead.contact?.email : null, lead.contact?.phone].filter(Boolean).join(", ") || " "}
          </div>
        </div>

        <div>
          <label htmlFor={`stage-${lead.id}`} className="sr-only">
            Stage for {name}
          </label>
          <select
            id={`stage-${lead.id}`}
            value={lead.status}
            onChange={(e) => updateStatus(e.target.value)}
            disabled={busy}
            className={`h-8 w-full cursor-pointer px-2 text-[13px] font-medium ${STAGE_CONTROL[lead.status] ?? ""}`}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
        </div>

        <div className="tabular text-[13.5px] text-ink">
          <span className="text-gray-500 md:hidden">Score </span>
          {lead.score != null ? lead.score : <span className="text-gray-400">–</span>}
        </div>

        <div className={`truncate text-[13px] ${runningRun ? "text-ink" : "text-gray-500"}`}>
          <span className="text-gray-500 md:hidden">Follow-up: </span>
          {followUpText}
        </div>

        <div className="text-[13px] text-gray-500">{formatDate(lead.created_at, { day: "numeric", month: "short" })}</div>

        <div className="md:text-right">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={detailsId}
            className={`${btn.ghost} ${btn.small}`}
          >
            {open ? "Hide" : "Details"}
          </button>
        </div>
      </div>

      {error && (
        <p className="m-0 px-5 pb-3 text-[13px] text-alert" role="alert">
          {error}
        </p>
      )}

      {open && (
        <div id={detailsId} className="grid gap-6 border-t border-gray-100 bg-gray-50 px-5 py-5 md:grid-cols-2">
          <div>
            <h3 className="m-0 mb-2 text-[13px] font-semibold text-ink">
              Why this score{lead.score != null ? ` (${lead.score} of 100)` : ""}
            </h3>
            {hasAnswers || lead.contact?.email || lead.contact?.phone ? (
              <ul className="m-0 grid list-none gap-1.5 p-0">
                {reasons.map((r) => (
                  <li key={r.label} className="flex items-baseline justify-between gap-4 text-[13px]">
                    <span className={r.met ? "text-ink" : "text-gray-400"}>{r.label}</span>
                    <span className={`tabular ${r.met ? "text-ink-600" : "text-gray-300"}`}>+{r.points}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-[13px] text-gray-500">Elliot hasn&apos;t collected any answers from this lead yet.</p>
            )}
            {hasAnswers && (
              <>
                <button
                  type="button"
                  onClick={() => setShowRaw((v) => !v)}
                  className="mt-3 cursor-pointer border-0 bg-transparent p-0 text-[12.5px] text-gray-500 underline hover:text-ink"
                >
                  {showRaw ? "Hide all answers" : "Show all answers"}
                </button>
                {showRaw && (
                  <pre className="mb-0 mt-2 overflow-x-auto rounded-md border border-gray-200 bg-white p-3 text-[12px]">
                    {JSON.stringify(lead.qualification_answers, null, 2)}
                  </pre>
                )}
              </>
            )}
          </div>

          <div>
            <h3 className="m-0 mb-2 text-[13px] font-semibold text-ink">Follow-up emails</h3>
            {runningRun ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[13px] text-ink">In sequence: {runningRun.sequenceName}</span>
                <button type="button" onClick={stopFollowUp} disabled={busy} className={`${btn.secondary} ${btn.small}`}>
                  Stop follow-up
                </button>
              </div>
            ) : isClosed ? (
              <p className="m-0 text-[13px] text-gray-500">This lead is {humanize(lead.status).toLowerCase()}, so no follow-up is needed.</p>
            ) : !hasEmail ? (
              <p className="m-0 text-[13px] text-gray-500">No email address, so this lead can&apos;t get email follow-ups.</p>
            ) : sequences.length === 0 ? (
              <p className="m-0 text-[13px] text-gray-500">
                Create a sequence in{" "}
                <a href="/dashboard/follow-ups" className="text-ink underline">
                  Follow-ups
                </a>{" "}
                to start one for this lead.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor={`seq-${lead.id}`} className="sr-only">
                  Sequence
                </label>
                <select
                  id={`seq-${lead.id}`}
                  value={sequenceId}
                  onChange={(e) => setSequenceId(e.target.value)}
                  disabled={busy}
                  className="h-8 px-2 text-[13px]"
                >
                  {sequences.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={startFollowUp} disabled={busy || !sequenceId} className={`${btn.primary} ${btn.small}`}>
                  Start follow-up
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
