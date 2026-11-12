"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { btn, humanize, timeAgo } from "../../../_ui/ui";
import { ChannelTile } from "../../../_ui/brands";
import { lookingFor } from "@/lib/conversation-summary";
import { LEAD_GRID } from "./grid";
import { contactLabel } from "@/lib/contacts";
import { sellerLabel, valuationOf, valuationRows } from "@/lib/valuation";

type Lead = {
  id: string;
  tenant_id: string;
  status: string;
  score: number | string | null;
  qualification_answers: Record<string, unknown> | null;
  /** 0043: buy | rent | sell | let */
  intent?: string | null;
  created_at: string;
  contact: { name: string | null; email: string | null; phone: string | null } | null;
  owner?: { full_name: string | null; email: string } | null;
};

// Real values confirmed via leads_status_check constraint.
const STATUS_OPTIONS = ["NEW", "QUALIFYING", "HOT", "WARM", "COLD", "CONVERTED", "LOST"];
const CLOSED_STATUSES = ["CONVERTED", "LOST"];

// The stage control is a coloured pill, the same colours as the Overview's
// pipeline and the Conversations list.
const STAGE_CONTROL: Record<string, string> = {
  NEW: "bg-gray-100 text-gray-700",
  QUALIFYING: "bg-accent-soft text-accent-dark",
  WARM: "bg-brass-soft text-brass-dark",
  HOT: "bg-alert-soft text-alert-dark",
  COLD: "bg-gray-100 text-gray-600",
  CONVERTED: "bg-[#e3f6ea] text-[#1f6b40]",
  LOST: "bg-gray-100 text-gray-500",
};
const SCORE_COLOR = (n: number) => (n >= 80 ? "#F07167" : n >= 50 ? "#D9A56C" : "#97A6BC");

const initials = (s: string) =>
  s
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

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
  onWhatsApp = false,
  channel = null,
  nextViewing = null,
  lastContact = null,
}: {
  /** Where the client first wrote: chat_widget, whatsapp, email, sms. */
  channel?: string | null;
  /** "Viewing Thu 19 Nov 17:00" when one is booked. */
  nextViewing?: string | null;
  /** When the client last wrote or was written to. */
  lastContact?: string | null;
  /** The client has written to the agency on WhatsApp, so follow-ups can go there (0045). */
  onWhatsApp?: boolean;
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
  // 0045: follow-ups go by email or, for clients who wrote on WhatsApp, by WhatsApp.
  const reachable = hasEmail || onWhatsApp;
  const isClosed = CLOSED_STATUSES.includes(lead.status);
  const reasons = computeScoreReasons(lead);
  const hasAnswers = !!lead.qualification_answers && Object.keys(lead.qualification_answers).length > 0;
  const name = contactLabel(lead.contact);
  const detailsId = `lead-details-${lead.id}`;
  const seller = sellerLabel(lead.intent, lead.qualification_answers);
  const valuation = valuationOf(lead.qualification_answers);

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
      : !reachable
        ? "No email or WhatsApp"
        : "None";

  const score = lead.score != null && Number.isFinite(Number(lead.score)) ? Math.round(Number(lead.score)) : null;
  const wants = lookingFor(lead.qualification_answers);
  const ownerName = lead.owner ? lead.owner.full_name || lead.owner.email : null;
  const nextStep = nextViewing || (runningRun ? `Follow-up: ${runningRun.sequenceName}` : followUpText === "None" ? null : followUpText);

  return (
    <li className="rounded-2xl border border-[rgba(15,31,56,0.06)] bg-[#f3f6fb] transition-colors hover:border-gold/40 hover:bg-white">
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3 ${LEAD_GRID}`}>
        {/* The person */}
        <div className="flex min-w-0 flex-1 basis-[220px] items-center gap-3 xl:basis-auto">
          <span className="hidden w-6 flex-shrink-0 text-right text-[12px] text-gray-400 xl:block">{number}</span>
          <span aria-hidden="true" className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#e3e9f2] text-[12px] font-bold text-accent-dark">
            {initials(name) || "?"}
          </span>
          <div className="min-w-0">
            <div className={`flex min-w-0 items-center gap-1.5 text-[14px] font-semibold ${isClosed ? "text-gray-500" : "text-ink"}`}>
              <span className="truncate">{name}</span>
              {seller && (
                <span className="flex-shrink-0 rounded-full border border-brass/30 bg-brass-soft px-1.5 py-px text-[11px] font-medium text-brass-dark" title="Asked for a valuation of their property">
                  {seller}
                </span>
              )}
            </div>
            <div className="truncate text-[12.5px] text-gray-500">
              {[lead.contact?.name ? lead.contact?.email : null, lead.contact?.phone].filter(Boolean).join(" · ") || "No email or phone yet"}
            </div>
          </div>
        </div>

        {/* Where they came from */}
        <div className="hidden xl:block" title={channel ? humanize(channel) : undefined}>
          {channel ? <ChannelTile channel={channel} size={28} /> : <span className="text-gray-400">–</span>}
        </div>

        {/* Stage: a pill you can change */}
        <div>
          <label htmlFor={`stage-${lead.id}`} className="sr-only">
            Stage for {name}
          </label>
          <select
            id={`stage-${lead.id}`}
            value={lead.status}
            onChange={(e) => updateStatus(e.target.value)}
            disabled={busy}
            className={`h-8 w-[128px] cursor-pointer !rounded-full !border-0 px-3 text-[12.5px] font-semibold ${STAGE_CONTROL[lead.status] ?? STAGE_CONTROL.NEW}`}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
        </div>

        {/* Score */}
        <div className="flex items-center gap-2" title="Score out of 100 (Details shows why)">
          {score != null ? (
            <>
              <span className="h-1.5 w-14 overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
                <span className="block h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, score))}%`, background: SCORE_COLOR(score) }} />
              </span>
              <span className="tabular text-[13px] font-bold text-ink">
                <span className="sr-only">Score </span>
                {score}
              </span>
            </>
          ) : (
            <span className="text-gray-400">–</span>
          )}
        </div>

        {/* What they want */}
        <div className="hidden min-w-0 truncate text-[13px] text-gray-700 xl:block" title={wants ?? undefined}>
          {wants || <span className="text-gray-400">Not known yet</span>}
        </div>

        {/* Owner */}
        <div className="hidden xl:block">
          {ownerName ? (
            <span title={ownerName} className="gold-fill flex h-7 w-7 items-center justify-center rounded-full text-[10.5px] font-bold text-ink">
              {initials(ownerName)}
            </span>
          ) : (
            <span className="text-[12.5px] text-gray-400" title="No owner yet">
              –
            </span>
          )}
        </div>

        {/* Next step */}
        <div className={`min-w-0 basis-full truncate text-[13px] xl:basis-auto ${nextViewing ? "font-medium text-[#237a49]" : runningRun ? "text-ink" : "text-gray-500"}`}>
          <span className="text-gray-500 xl:hidden">{wants ? `${wants} · ` : ""}</span>
          {nextStep || "No next step yet"}
        </div>

        {/* Last contact */}
        <div className="hidden whitespace-nowrap text-right text-[12.5px] text-gray-500 xl:block">{timeAgo(lastContact || lead.created_at)}</div>

        <div className="ml-auto xl:ml-0 xl:text-right">
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
        <p className="m-0 px-4 pb-3 text-[13px] text-alert" role="alert">
          {error}
        </p>
      )}

      {open && (
        <div id={detailsId} className="grid gap-6 rounded-b-2xl border-t border-gray-200 bg-white px-5 py-5 md:grid-cols-2">
          {valuation && (
            <div className="md:col-span-2">
              <h3 className="m-0 mb-2 text-[13px] font-semibold text-ink">Property to value</h3>
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
                {valuationRows(valuation).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-gray-500">{k}</dt>
                    <dd className="m-0 text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
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
            <h3 className="m-0 mb-2 text-[13px] font-semibold text-ink">Follow-ups</h3>
            {runningRun ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[13px] text-ink">In sequence: {runningRun.sequenceName}</span>
                <button type="button" onClick={stopFollowUp} disabled={busy} className={`${btn.secondary} ${btn.small}`}>
                  Stop follow-up
                </button>
              </div>
            ) : isClosed ? (
              <p className="m-0 text-[13px] text-gray-500">This lead is {humanize(lead.status).toLowerCase()}, so no follow-up is needed.</p>
            ) : !reachable ? (
              <p className="m-0 text-[13px] text-gray-500">No email address and no WhatsApp chat, so this lead can&apos;t get follow-ups.</p>
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
