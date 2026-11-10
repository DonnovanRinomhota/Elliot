"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { displaySteps } from "@/lib/follow-up-steps";
import SequenceEditor from "./sequence-editor";
import { Badge, EmptyState, btn } from "../../../_ui/ui";

export type SequenceRow = {
  id: string;
  name: string;
  is_active: boolean;
  steps: unknown;
  auto_enrol: boolean;
  auto_enrol_after_hours: number;
};

// Choices for "how long quiet before auto-enrolling". The column allows 1-720.
const QUIET_HOUR_OPTIONS = [12, 24, 48, 72, 168];

function quietLabel(hours: number): string {
  if (hours % 24 === 0) return hours === 24 ? "1 day" : `${hours / 24} days`;
  return `${hours} hours`;
}

export type RunCounts = { running: number; completed: number; stopped: number };

const NO_RUNS: RunCounts = { running: 0, completed: 0, stopped: 0 };

function runSummary(c: RunCounts): string {
  const total = c.running + c.completed + c.stopped;
  if (total === 0) return "Not started for any lead yet.";
  const parts: string[] = [];
  if (c.running) parts.push(`${c.running} in progress`);
  if (c.completed) parts.push(`${c.completed} completed`);
  if (c.stopped) parts.push(`${c.stopped} stopped`);
  return parts.join(", ");
}

function SequenceCard({
  sequence,
  counts,
  onEdit,
  otherAutoSequence,
}: {
  sequence: SequenceRow;
  counts: RunCounts;
  onEdit: () => void;
  /** The tenant's current auto-enrol sequence, if it's a different one. Only one is allowed. */
  otherAutoSequence: SequenceRow | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quietHours, setQuietHours] = useState<number>(
    QUIET_HOUR_OPTIONS.includes(sequence.auto_enrol_after_hours) ? sequence.auto_enrol_after_hours : 24
  );

  const steps = displaySteps(sequence.steps);
  const totalRuns = counts.running + counts.completed + counts.stopped;

  // Auto-enrolment itself happens in the database + workflow 29
  // (enrol_quiet_leads(), migration 0026). This only flips the flag; the DB
  // stamps auto_enrol_since so switching it on never back-fills old leads.
  async function setAutoEnrol(on: boolean) {
    if (on && otherAutoSequence) {
      const ok = window.confirm(
        `"${otherAutoSequence.name}" is currently auto-enrolling leads. Only one sequence can, so it will be switched off. Continue?`
      );
      if (!ok) return;
    }
    setBusy(true);
    setError(null);

    if (on && otherAutoSequence) {
      const { error: offError } = await supabase
        .from("follow_up_sequences")
        .update({ auto_enrol: false })
        .eq("id", otherAutoSequence.id);
      if (offError) {
        setBusy(false);
        return setError(offError.message);
      }
    }

    const { data, error: updateError } = await supabase
      .from("follow_up_sequences")
      .update(on ? { auto_enrol: true, auto_enrol_after_hours: quietHours } : { auto_enrol: false })
      .eq("id", sequence.id)
      .select("id");
    setBusy(false);
    if (updateError) {
      return setError(
        updateError.code === "23505"
          ? "Another sequence is already auto-enrolling leads. Refresh the page and try again."
          : updateError.message
      );
    }
    if (!data || data.length === 0) return setError("This sequence couldn't be found. It may have been deleted.");
    router.refresh();
  }

  async function toggleActive() {
    setBusy(true);
    setError(null);
    const { data, error: updateError } = await supabase
      .from("follow_up_sequences")
      .update({ is_active: !sequence.is_active })
      .eq("id", sequence.id)
      .select("id");
    setBusy(false);
    if (updateError) return setError(updateError.message);
    if (!data || data.length === 0) return setError("This sequence couldn't be found. It may have been deleted.");
    router.refresh();
  }

  async function remove() {
    if (!window.confirm(`Delete "${sequence.name}"? This can't be undone.`)) return;
    setBusy(true);
    setError(null);
    const { data, error: deleteError } = await supabase
      .from("follow_up_sequences")
      .delete()
      .eq("id", sequence.id)
      .select("id");
    setBusy(false);
    if (deleteError) return setError(deleteError.message);
    if (!data || data.length === 0) return setError("This sequence couldn't be found. It may already be deleted.");
    router.refresh();
  }

  return (
    <article className="card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-[15px] font-semibold text-ink">{sequence.name}</h2>
            <Badge tone={sequence.is_active ? "ink" : "muted"}>{sequence.is_active ? "Active" : "Inactive"}</Badge>
            {sequence.auto_enrol && <Badge tone="brass">Auto-enrol</Badge>}
          </div>
          <p className="m-0 mt-0.5 text-[12.5px] text-gray-500">{runSummary(counts)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onEdit} disabled={busy} className={`${btn.secondary} ${btn.small}`}>
            Edit
          </button>
          <button type="button" onClick={toggleActive} disabled={busy} className={`${btn.secondary} ${btn.small}`}>
            {sequence.is_active ? "Deactivate" : "Activate"}
          </button>
          {totalRuns === 0 && (
            <button type="button" onClick={remove} disabled={busy} className={`${btn.dangerGhost} ${btn.small}`}>
              Delete
            </button>
          )}
        </div>
      </header>

      <div className="px-5 py-4">
        {steps.length === 0 ? (
          <p className="m-0 text-[13px] text-gray-500">No messages yet. Edit this sequence to add some.</p>
        ) : (
          <ol className="m-0 grid list-none gap-2 p-0">
            {steps.map((s, i) => (
              <li key={i} className="grid grid-cols-[64px_minmax(0,1fr)] items-baseline gap-3">
                <span className="tabular text-[12.5px] text-gray-500">Day {s.day}</span>
                <span className="truncate text-[13.5px] text-ink">
                  {s.channel === "whatsapp" && (
                    <span className="mr-1.5 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent-dark">WhatsApp</span>
                  )}
                  {s.subject}
                </span>
              </li>
            ))}
          </ol>
        )}

        {!sequence.is_active && (
          <p className="mb-0 mt-3 text-[13px] text-gray-500">
            New leads can&apos;t be added while this is inactive.
            {counts.running > 0 && ` The ${counts.running} already in progress will finish or stop when the lead replies.`}
          </p>
        )}
      </div>

      <div className="border-t border-gray-100 bg-gray-50 px-5 py-3">
        {sequence.auto_enrol ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 max-w-xl text-[13px] text-gray-600">
              New leads that go quiet for {quietLabel(sequence.auto_enrol_after_hours)} are added automatically, unless
              they&apos;ve booked a viewing, are converted or lost, or can&apos;t be reached (no email address and no WhatsApp chat).
              {!sequence.is_active && " Paused while this sequence is inactive."}
            </p>
            <button type="button" onClick={() => setAutoEnrol(false)} disabled={busy} className={`${btn.secondary} ${btn.small}`}>
              Turn off auto-enrol
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`quiet-${sequence.id}`} className="text-[13px] text-gray-600">
              Auto-enrol new leads that go quiet for
            </label>
            <select
              id={`quiet-${sequence.id}`}
              value={quietHours}
              onChange={(e) => setQuietHours(Number(e.target.value))}
              disabled={busy}
              className="h-8 px-2 text-[13px]"
            >
              {QUIET_HOUR_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {quietLabel(h)}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => setAutoEnrol(true)} disabled={busy || steps.length === 0} className={`${btn.secondary} ${btn.small}`}>
              Turn on
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="m-0 px-5 pb-3 pt-2 text-[13px] text-alert" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

export default function SequencesManager({
  tenantId,
  sequences,
  runCounts,
}: {
  tenantId: string;
  sequences: SequenceRow[];
  runCounts: Record<string, RunCounts>;
}) {
  // "new" | a sequence id | null
  const [editing, setEditing] = useState<string | null>(null);

  const showEmpty = sequences.length === 0 && editing !== "new";
  const autoSequence = sequences.find((s) => s.auto_enrol) ?? null;

  return (
    <div className="max-w-3xl">
      {editing !== "new" && sequences.length > 0 && (
        <div className="mb-4">
          <button type="button" onClick={() => setEditing("new")} className={btn.primary}>
            New sequence
          </button>
        </div>
      )}

      {editing === "new" && (
        <div className="mb-4">
          <SequenceEditor tenantId={tenantId} sequence={null} runningCount={0} onClose={() => setEditing(null)} />
        </div>
      )}

      {showEmpty && (
        <EmptyState title="No sequences yet">
          <p className="m-0 mb-4">A sequence is a short series of emails or WhatsApp messages sent after a lead goes quiet. It stops as soon as they reply.</p>
          <button type="button" onClick={() => setEditing("new")} className={btn.primary}>
            Create your first sequence
          </button>
        </EmptyState>
      )}

      <div className="grid gap-4">
        {sequences.map((seq) =>
          editing === seq.id ? (
            <SequenceEditor
              key={seq.id}
              tenantId={tenantId}
              sequence={{ id: seq.id, name: seq.name, steps: seq.steps }}
              runningCount={(runCounts[seq.id] ?? NO_RUNS).running}
              onClose={() => setEditing(null)}
            />
          ) : (
            <SequenceCard
              key={seq.id}
              sequence={seq}
              counts={runCounts[seq.id] ?? NO_RUNS}
              onEdit={() => setEditing(seq.id)}
              otherAutoSequence={autoSequence && autoSequence.id !== seq.id ? autoSequence : null}
            />
          )
        )}
      </div>
    </div>
  );
}
