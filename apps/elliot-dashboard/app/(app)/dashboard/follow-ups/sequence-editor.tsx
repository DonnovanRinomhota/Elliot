"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  MAX_STEPS,
  SUPPORTED_PLACEHOLDER,
  stepsFromJson,
  validateSequence,
  type DraftStep,
  type ValidationErrors,
} from "@/lib/follow-up-steps";

type ExistingSequence = { id: string; name: string; steps: unknown };

// Starting point for "New sequence" -- an editable draft, not saved until the
// user clicks Save. Uses only {{contact_name}}, the one placeholder the sweep
// substitutes (falling back to "there" when the contact has no name).
const STARTER_STEPS: Omit<DraftStep, "key">[] = [
  {
    day: "0",
    subject: "Thanks for reaching out",
    body: "Hi {{contact_name}},\n\nThanks for getting in touch. I wanted to make sure you have everything you need and to answer any questions.\n\nJust reply to this email and I'll get back to you.",
  },
  {
    day: "3",
    subject: "Following up",
    body: "Hi {{contact_name}},\n\nJust following up on my earlier note. Is there anything I can help with, or a good time for a quick call?",
  },
  {
    day: "7",
    subject: "One last check-in",
    body: "Hi {{contact_name}},\n\nI don't want to crowd your inbox, so this is my last note for now. If the timing changes, just reply and we'll pick things up from there.",
  },
];

const inputClass =
  "w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink";
const labelClass = "mb-1 block text-xs font-medium text-gray-600";

export default function SequenceEditor({
  tenantId,
  sequence,
  runningCount,
  onClose,
}: {
  tenantId: string;
  /** null = creating a new sequence. */
  sequence: ExistingSequence | null;
  /** Runs currently in progress for this sequence (0 for a new one). */
  runningCount: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();

  const keyCounter = useRef(0);
  const nextKey = () => `step-${keyCounter.current++}`;
  const bodyRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const [name, setName] = useState(sequence?.name ?? "");
  const [steps, setSteps] = useState<DraftStep[]>(() => {
    if (sequence) {
      const existing = stepsFromJson(sequence.steps, nextKey);
      return existing.length > 0 ? existing : [{ key: nextKey(), day: "0", subject: "", body: "" }];
    }
    return STARTER_STEPS.map((s) => ({ ...s, key: nextKey() }));
  });
  const [errors, setErrors] = useState<ValidationErrors>({ stepErrors: {} });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isNew = sequence === null;

  function updateStep(key: string, patch: Partial<DraftStep>) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  function addStep() {
    const days = steps.map((s) => Number(s.day.trim())).filter((n) => Number.isInteger(n) && n >= 0);
    const nextDay = days.length > 0 ? Math.max(...days) + 3 : 0;
    setSteps((prev) => [...prev, { key: nextKey(), day: String(nextDay), subject: "", body: "" }]);
  }

  function removeStep(key: string) {
    setSteps((prev) => (prev.length > 1 ? prev.filter((s) => s.key !== key) : prev));
  }

  // Keep the on-screen order identical to what gets saved (ascending by day).
  // Only re-sorts once every day is a valid whole number, so it never shuffles
  // rows while someone is mid-edit on a blank or half-typed field.
  function sortByDayWhenValid() {
    setSteps((prev) =>
      prev.every((s) => /^\d+$/.test(s.day.trim()))
        ? [...prev].sort((a, b) => Number(a.day) - Number(b.day))
        : prev
    );
  }

  function insertPlaceholder(key: string) {
    const step = steps.find((s) => s.key === key);
    if (!step) return;
    const el = bodyRefs.current[key];
    const start = el?.selectionStart ?? step.body.length;
    const end = el?.selectionEnd ?? start;
    updateStep(key, { body: step.body.slice(0, start) + SUPPORTED_PLACEHOLDER + step.body.slice(end) });
    const caret = start + SUPPORTED_PLACEHOLDER.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }

  async function save() {
    setSaveError(null);
    const result = validateSequence({ name, steps });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({ stepErrors: {} });
    setSaving(true);

    if (isNew) {
      const { error } = await supabase
        .from("follow_up_sequences")
        .insert({ tenant_id: tenantId, name: result.name, steps: result.steps, is_active: true });
      setSaving(false);
      if (error) return setSaveError(error.message);
    } else {
      // .select() so a row hidden by RLS (0 rows updated, no error) is reported
      // instead of looking like a successful save.
      const { data, error } = await supabase
        .from("follow_up_sequences")
        .update({ name: result.name, steps: result.steps })
        .eq("id", sequence.id)
        .select("id");
      setSaving(false);
      if (error) return setSaveError(error.message);
      if (!data || data.length === 0) return setSaveError("This sequence couldn't be found. It may have been deleted.");
    }

    onClose();
    router.refresh();
  }

  const errorCount = (errors.name ? 1 : 0) + (errors.steps ? 1 : 0) + Object.keys(errors.stepErrors).length;

  return (
    <div className="mb-6 rounded-xl border border-gray-300 bg-white p-5">
      <div className="mb-4">
        <div className="text-sm font-medium">{isNew ? "New sequence" : "Edit sequence"}</div>
        <div className="text-xs text-gray-500">Each step is sent to the lead as an email.</div>
      </div>

      {!isNew && runningCount > 0 && (
        <p className="mb-4 rounded-md bg-amber-soft px-3 py-2 text-xs text-amber-dark" role="note">
          {runningCount} {runningCount === 1 ? "lead is" : "leads are"} partway through this sequence. They keep their
          current schedule and pick up your changes from their next step. Adding steps at the end is safe. Removing
          or inserting steps earlier in the sequence can make those leads skip or repeat a message.
        </p>
      )}

      <div className="mb-5">
        <label htmlFor="seq-name" className={labelClass}>
          Sequence name
        </label>
        <input
          id="seq-name"
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. New lead follow-up"
          aria-invalid={Boolean(errors.name)}
        />
        {errors.name && <p className="mt-1 text-xs text-red-700">{errors.name}</p>}
      </div>

      <p className="mb-3 text-xs text-gray-500">
        Days are counted from when the sequence starts for a lead. Day 0 goes out at the next check, which runs every
        15 minutes. In your messages, {SUPPORTED_PLACEHOLDER} becomes the lead&apos;s name, or &ldquo;there&rdquo; if
        we don&apos;t have one.
      </p>

      <ol className="mb-3 flex flex-col gap-3">
        {steps.map((step, i) => {
          const stepError = errors.stepErrors[step.key];
          return (
            <li key={step.key} className={`rounded-lg border p-4 ${stepError ? "border-red-300" : "border-gray-200"}`}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-gray-700">Step {i + 1}</div>
                <button
                  type="button"
                  onClick={() => removeStep(step.key)}
                  disabled={steps.length === 1}
                  className="text-xs text-coral-dark hover:underline disabled:cursor-not-allowed disabled:text-gray-300 disabled:no-underline"
                >
                  Remove step
                </button>
              </div>

              <div className="mb-3 flex items-center gap-2">
                <label htmlFor={`${step.key}-day`} className="text-xs font-medium text-gray-600">
                  Send on day
                </label>
                <input
                  id={`${step.key}-day`}
                  className="w-20 rounded-md border border-gray-200 px-2 py-1.5 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                  inputMode="numeric"
                  value={step.day}
                  onChange={(e) => updateStep(step.key, { day: e.target.value })}
                  onBlur={sortByDayWhenValid}
                />
              </div>

              <div className="mb-3">
                <label htmlFor={`${step.key}-subject`} className={labelClass}>
                  Subject
                </label>
                <input
                  id={`${step.key}-subject`}
                  className={inputClass}
                  value={step.subject}
                  onChange={(e) => updateStep(step.key, { subject: e.target.value })}
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label htmlFor={`${step.key}-body`} className="text-xs font-medium text-gray-600">
                    Message
                  </label>
                  <button
                    type="button"
                    onClick={() => insertPlaceholder(step.key)}
                    className="text-xs text-gray-500 hover:text-ink hover:underline"
                  >
                    Insert lead&apos;s name
                  </button>
                </div>
                <textarea
                  id={`${step.key}-body`}
                  ref={(el) => {
                    bodyRefs.current[step.key] = el;
                  }}
                  className={`${inputClass} min-h-28 resize-y`}
                  rows={6}
                  value={step.body}
                  onChange={(e) => updateStep(step.key, { body: e.target.value })}
                />
              </div>

              {stepError && (
                <p className="mt-2 text-xs text-red-700" role="alert">
                  {stepError}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {errors.steps && <p className="mb-3 text-xs text-red-700">{errors.steps}</p>}

      <button
        type="button"
        onClick={addStep}
        disabled={steps.length >= MAX_STEPS}
        className="mb-5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {steps.length >= MAX_STEPS ? `Limit of ${MAX_STEPS} steps reached` : "Add step"}
      </button>

      {errorCount > 0 && (
        <p className="mb-3 text-xs text-red-700" role="alert">
          Fix {errorCount} {errorCount === 1 ? "problem" : "problems"} above before saving.
        </p>
      )}
      {saveError && (
        <p className="mb-3 text-xs text-red-700" role="alert">
          Couldn&apos;t save: {saveError}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-ink px-4 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save sequence"}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="rounded-md px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
