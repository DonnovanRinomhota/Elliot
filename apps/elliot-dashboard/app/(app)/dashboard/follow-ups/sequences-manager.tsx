"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { displaySteps } from "@/lib/follow-up-steps";
import SequenceEditor from "./sequence-editor";

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
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <div className="text-sm font-medium">{sequence.name}</div>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            sequence.is_active ? "bg-pulse-soft text-pulse-dark" : "bg-gray-100 text-gray-500"
          }`}
        >
          {sequence.is_active ? "Active" : "Inactive"}
        </span>
        {sequence.auto_enrol && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">Auto-enrol</span>
        )}
      </div>
      <p className="mb-4 text-xs text-gray-500">{runSummary(counts)}</p>

      {steps.length === 0 ? (
        <p className="mb-4 text-xs text-gray-400">No steps yet. Edit this sequence to add some.</p>
      ) : (
        <ol className="mb-4 flex flex-col gap-1.5">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="w-14 shrink-0 text-xs text-gray-400">Day {s.day}</span>
              <span className="min-w-0 truncate text-gray-700">{s.subject}</span>
            </li>
          ))}
        </ol>
      )}

      <div className="mb-4 rounded-md bg-gray-50 px-3 py-2.5">
        {sequence.auto_enrol ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="max-w-md text-xs text-gray-600">
              New leads that go quiet for {quietLabel(sequence.auto_enrol_after_hours)} are added automatically, unless
              they&apos;ve booked a viewing, are marked Converted or Lost, or have no email address.
              {!sequence.is_active && " Paused while this sequence is inactive."}
            </p>
            <button
              type="button"
              onClick={() => setAutoEnrol(false)}
              disabled={busy}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Turn off auto-enrol
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`quiet-${sequence.id}`} className="text-xs text-gray-600">
              Auto-enrol new leads that go quiet for
            </label>
            <select
              id={`quiet-${sequence.id}`}
              value={quietHours}
              onChange={(e) => setQuietHours(Number(e.target.value))}
              disabled={busy}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs"
            >
              {QUIET_HOUR_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {quietLabel(h)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setAutoEnrol(true)}
              disabled={busy || steps.length === 0}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Turn on
            </button>
          </div>
        )}
      </div>

      {!sequence.is_active && (
        <p className="mb-3 text-xs text-gray-500">
          New leads can&apos;t be added while this is inactive.
          {counts.running > 0 &&
            ` The ${counts.running} already in progress will keep sending until they finish or the lead replies.`}
        </p>
      )}

      {error && (
        <p className="mb-3 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onEdit}
          disabled={busy}
          className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={toggleActive}
          disabled={busy}
          className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {sequence.is_active ? "Deactivate" : "Activate"}
        </button>
        {totalRuns === 0 && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-xs text-coral-dark hover:underline disabled:opacity-50"
          >
            Delete
          </button>
        )}
      </div>
    </div>
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
    <div className="max-w-2xl">
      {editing !== "new" && sequences.length > 0 && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="rounded-md bg-ink px-4 py-2 text-xs font-medium text-white hover:opacity-90"
          >
            New sequence
          </button>
        </div>
      )}

      {editing === "new" && (
        <SequenceEditor tenantId={tenantId} sequence={null} runningCount={0} onClose={() => setEditing(null)} />
      )}

      {showEmpty && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <div className="mb-1 text-sm font-medium">No sequences yet</div>
          <p className="mx-auto mb-4 max-w-sm text-xs text-gray-500">
            A sequence is a set of emails sent on a schedule after a lead is added to it, stopping as soon as the lead
            replies.
          </p>
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="rounded-md bg-ink px-4 py-2 text-xs font-medium text-white hover:opacity-90"
          >
            Create your first sequence
          </button>
        </div>
      )}

      <div className="flex flex-col gap-4">
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
