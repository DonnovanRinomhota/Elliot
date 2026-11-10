// Pure rules for the platform control panel, kept out of the pages so they
// can be unit tested (lib/platform.test.ts).

export type TenantOverviewRow = {
  tenant_id: string;
  name: string;
  slug: string;
  industry: string | null;
  plan: string;
  status: string;
  created_at: string;
  trial_ends_at: string | null;
  paid_until: string | null;
  monthly_price: number | string | null;
  contact_email: string | null;
  users_count: number | string;
  listings_count: number | string;
  conversations_count: number | string;
  leads_count: number | string;
  hot_leads_count: number | string;
  appointments_count: number | string;
  open_escalations: number | string;
  pending_approvals: number | string;
  failed_crm_syncs: number | string;
  tool_errors: number | string;
  input_tokens: number | string;
  output_tokens: number | string;
  ai_replies: number | string;
  last_activity_at: string | null;
};

export type AccountState =
  | "trial"
  | "trial_ended"
  | "active"
  | "past_due"
  | "complimentary"
  | "suspended"
  | "cancelled";

export const ACCOUNT_STATE_LABEL: Record<AccountState, string> = {
  trial: "Free trial",
  trial_ended: "Trial ended",
  active: "Active",
  past_due: "Past due",
  complimentary: "Complimentary",
  suspended: "Suspended",
  cancelled: "Cancelled",
};

/**
 * One label per agency, from plan + status + dates.
 * Suspended/cancelled win; then trial (by end date); complimentary never
 * expires; paid plans are past due once paid_until has passed. A paid plan
 * with no paid_until yet counts as active (you haven't recorded a payment
 * date, not "they haven't paid").
 */
export function accountState(
  t: Pick<TenantOverviewRow, "plan" | "status" | "trial_ends_at" | "paid_until">,
  now: Date = new Date()
): AccountState {
  if (t.status === "cancelled") return "cancelled";
  if (t.status === "suspended") return "suspended";
  if (t.plan === "complimentary") return "complimentary";
  if (t.plan === "trial") {
    return t.trial_ends_at && new Date(t.trial_ends_at) < now ? "trial_ended" : "trial";
  }
  if (t.paid_until && new Date(t.paid_until) < now) return "past_due";
  return "active";
}

/** Whole days from now until `iso` (negative = in the past). */
export function daysUntil(iso: string, now: Date = new Date()): number {
  const ms = new Date(iso).getTime() - now.getTime();
  return Math.round(ms / 86_400_000);
}

export function relativeDays(iso: string, now: Date = new Date()): string {
  const d = daysUntil(iso, now);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

// Claude prices per million tokens, in USD. Defaults are Claude Sonnet 5's
// list prices (Nov 2026: $2 in, $10 out), the model workflow 01 uses. Cached
// tokens are already logged at their real cost by workflow 01 (reads 0.1x,
// writes 1.25x), so the input price covers them. CHECK anthropic.com/pricing
// and override with AI_PRICE_INPUT_PER_MTOK / AI_PRICE_OUTPUT_PER_MTOK in
// Vercel if they change.
export function aiPrices() {
  return {
    input: Number(process.env.AI_PRICE_INPUT_PER_MTOK || 2),
    output: Number(process.env.AI_PRICE_OUTPUT_PER_MTOK || 10),
  };
}

export function aiCostUsd(inputTokens: number, outputTokens: number, prices = aiPrices()): number {
  return (inputTokens / 1_000_000) * prices.input + (outputTokens / 1_000_000) * prices.output;
}

/** Problems worth a look, in plain words. Empty = healthy. */
export function healthIssues(t: TenantOverviewRow, state: AccountState, now: Date = new Date()): string[] {
  const issues: string[] = [];
  const n = (v: number | string) => Number(v || 0);
  if (n(t.failed_crm_syncs) > 0) issues.push(`${n(t.failed_crm_syncs)} CRM sync failed`);
  if (n(t.tool_errors) > 0) issues.push(`${n(t.tool_errors)} tool error${n(t.tool_errors) === 1 ? "" : "s"}`);
  if (n(t.open_escalations) >= 5) issues.push(`${n(t.open_escalations)} open escalations`);
  if (n(t.listings_count) === 0 && (t.industry || "").includes("real")) issues.push("No listings");
  const live = state === "active" || state === "trial" || state === "complimentary";
  if (live) {
    if (!t.last_activity_at) issues.push("No conversations yet");
    else if (daysUntil(t.last_activity_at, now) <= -7) issues.push("Quiet for 7+ days");
  }
  return issues;
}

/** Monthly recurring revenue: paying agencies that are active (not past due). */
export function monthlyRevenue(rows: TenantOverviewRow[], now: Date = new Date()): number {
  return rows
    .filter((r) => accountState(r, now) === "active")
    .reduce((sum, r) => sum + Number(r.monthly_price || 0), 0);
}
