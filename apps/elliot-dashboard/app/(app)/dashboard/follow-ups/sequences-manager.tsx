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
};

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
}: {
  sequence: SequenceRow;
  counts: RunCounts;
  onEdit: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const steps = displaySteps(sequence.steps);
  const totalRuns = counts.running + counts.completed + counts.stopped;

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
            />
          )
        )}
      </div>
    </div>
  );
}
