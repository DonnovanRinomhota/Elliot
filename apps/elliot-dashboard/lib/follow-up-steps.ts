/**
 * Shared shape + validation for follow_up_sequences.steps.
 *
 * Everything here is derived from what workflow 20 (the sweep) and workflow
 * 21 (start run) actually read -- see docs/workflow-specs/20-follow-up-sweep.md:
 *
 *  - `day_offset` is days after the RUN STARTED (next_run_at = run.created_at
 *    + day_offset days), not days after the previous step.
 *  - Progress is tracked by step INDEX (follow_up_runs.current_step_index), so
 *    steps must be stored in ascending day_offset order -- an out-of-order
 *    array would schedule a later step's next_run_at in the past.
 *  - Only `subject` and `body` are read. `channel` is not read by the sweep
 *    (it always sends email), but is kept as "email" to match the documented
 *    step shape.
 *  - The only placeholder substituted is {{contact_name}}, falling back to
 *    "there" when the contact has no name. Anything else would be sent to the
 *    contact literally, which is why unknown placeholders are rejected here
 *    rather than saved.
 *
 * Pure functions, no React / Supabase imports, so they're unit-testable with
 * plain `node:test` (see follow-up-steps.test.ts).
 */

export type SequenceStep = {
  day_offset: number;
  channel: "email";
  subject: string;
  body: string;
};

/** A step as the editor holds it: `day` stays a string so a blank field is representable. */
export type DraftStep = {
  key: string;
  day: string;
  subject: string;
  body: string;
};

export const MAX_STEPS = 10;
export const MAX_DAY_OFFSET = 365;
export const NAME_MAX = 80;
export const SUBJECT_MAX = 200;
export const BODY_MAX = 5000;

export const SUPPORTED_PLACEHOLDER = "{{contact_name}}";

export type ValidationErrors = {
  name?: string;
  steps?: string;
  /** Keyed by DraftStep.key. */
  stepErrors: Record<string, string>;
};

export type ValidationResult =
  | { ok: true; name: string; steps: SequenceStep[] }
  | { ok: false; errors: ValidationErrors };

/** Placeholders written as {{ something }} that the sweep does not substitute. */
export function findUnsupportedPlaceholders(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)) {
    if (match[1] !== "contact_name") found.push(match[0]);
  }
  return found;
}

/** {contact_name} with single braces -- the sweep would send that literally. */
export function hasSingleBracePlaceholder(text: string): boolean {
  return /(^|[^{])\{\s*contact_name\s*\}(?!\})/.test(text);
}

function checkText(label: string, value: string, max: number): string | null {
  if (!value.trim()) return `${label} is required.`;
  if (value.length > max) return `${label} must be ${max} characters or fewer.`;
  const unsupported = findUnsupportedPlaceholders(value);
  if (unsupported.length > 0) {
    return `${unsupported[0]} isn't supported and would be sent as written. Only ${SUPPORTED_PLACEHOLDER} is replaced.`;
  }
  if (hasSingleBracePlaceholder(value)) {
    return `Use double braces, ${SUPPORTED_PLACEHOLDER}. With single braces the placeholder would be sent as written.`;
  }
  return null;
}

export function validateSequence(input: { name: string; steps: DraftStep[] }): ValidationResult {
  const errors: ValidationErrors = { stepErrors: {} };

  const name = input.name.trim();
  if (!name) errors.name = "Give the sequence a name.";
  else if (name.length > NAME_MAX) errors.name = `Name must be ${NAME_MAX} characters or fewer.`;

  if (input.steps.length === 0) {
    errors.steps = "Add at least one step.";
  } else if (input.steps.length > MAX_STEPS) {
    errors.steps = `A sequence can have at most ${MAX_STEPS} steps.`;
  }

  const parsed: { key: string; step: SequenceStep }[] = [];
  const seenDays = new Map<number, string>();

  for (const draft of input.steps) {
    const dayText = draft.day.trim();
    const day = Number(dayText);
    let error: string | null = null;

    if (dayText === "" || !Number.isInteger(day)) {
      error = "Day must be a whole number, like 0, 3, or 7.";
    } else if (day < 0 || day > MAX_DAY_OFFSET) {
      error = `Day must be between 0 and ${MAX_DAY_OFFSET}.`;
    } else if (seenDays.has(day)) {
      error = `Another step is already set for day ${day}. Give each step its own day.`;
    }

    error =
      error ??
      checkText("Subject", draft.subject, SUBJECT_MAX) ??
      checkText("Message", draft.body, BODY_MAX);

    if (error) {
      errors.stepErrors[draft.key] = error;
      continue;
    }

    seenDays.set(day, draft.key);
    parsed.push({
      key: draft.key,
      step: { day_offset: day, channel: "email", subject: draft.subject.trim(), body: draft.body.trim() },
    });
  }

  const hasErrors = Boolean(errors.name) || Boolean(errors.steps) || Object.keys(errors.stepErrors).length > 0;
  if (hasErrors) return { ok: false, errors };

  // Ascending by day_offset: the sweep indexes steps by position, so order is load-bearing.
  const steps = parsed.map((p) => p.step).sort((a, b) => a.day_offset - b.day_offset);
  return { ok: true, name, steps };
}

/**
 * Reads follow_up_sequences.steps defensively. Rows can be hand-authored via
 * SQL (and migration 0005's original comment used a `template` key instead of
 * subject/body), so nothing here assumes the array is well-formed.
 */
export function stepsFromJson(json: unknown, makeKey: () => string): DraftStep[] {
  if (!Array.isArray(json)) return [];
  return json.map((raw) => {
    const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const day = typeof s.day_offset === "number" ? String(s.day_offset) : "0";
    return {
      key: makeKey(),
      day,
      subject: typeof s.subject === "string" ? s.subject : "",
      body: typeof s.body === "string" ? s.body : "",
    };
  });
}

/**
 * Steps for read-only display, in ARRAY order -- the order the sweep actually
 * runs them (it indexes by position), not re-sorted, so a hand-authored
 * out-of-order array is shown as it will really behave. Tolerates malformed rows.
 */
export function displaySteps(json: unknown): { day: number; subject: string }[] {
  if (!Array.isArray(json)) return [];
  return json.map((raw) => {
    const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    return {
      day: typeof s.day_offset === "number" ? s.day_offset : 0,
      subject: typeof s.subject === "string" && s.subject.trim() ? s.subject : "(no subject)",
    };
  });
}
