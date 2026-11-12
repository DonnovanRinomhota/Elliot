// Run with: npm test. Control-panel status, cost and health rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { accountState, aiCostUsd, healthIssues, monthlyRevenue, relativeDays, totalAiCostUsd, type TenantOverviewRow } from "./platform";

const NOW = new Date("2026-11-07T12:00:00Z");
const row = (over: Partial<TenantOverviewRow> = {}): TenantOverviewRow => ({
  tenant_id: "t", name: "A", slug: "a", industry: "real_estate", plan: "starter", status: "active",
  created_at: "2026-10-01T00:00:00Z", trial_ends_at: null, paid_until: null, monthly_price: 199, contact_email: null,
  users_count: 1, listings_count: 3, conversations_count: 0, leads_count: 0, hot_leads_count: 0, appointments_count: 0,
  open_escalations: 0, pending_approvals: 0, failed_crm_syncs: 0, tool_errors: 0, input_tokens: 0, output_tokens: 0,
  ai_replies: 0, last_activity_at: "2026-11-06T12:00:00Z", ...over,
});

test("account state", () => {
  const started = "2026-11-01T00:00:00Z";
  assert.equal(accountState(row({ plan: "trial", trial_started_at: started, trial_ends_at: "2026-11-10T00:00:00Z" }), NOW), "trial");
  assert.equal(accountState(row({ plan: "trial", trial_started_at: started, trial_ends_at: "2026-11-05T00:00:00Z" }), NOW), "trial_ended");
  // 0050: no trial started yet = being set up, whatever the old default date says.
  assert.equal(accountState(row({ plan: "trial", trial_ends_at: null }), NOW), "setup");
  assert.equal(accountState(row({ plan: "trial", trial_ends_at: "2026-11-01T00:00:00Z" }), NOW), "setup");
  assert.equal(accountState(row({ paid_until: "2026-12-01T00:00:00Z" }), NOW), "active");
  assert.equal(accountState(row({ paid_until: "2026-11-01T00:00:00Z" }), NOW), "past_due");
  assert.equal(accountState(row({ paid_until: null }), NOW), "active");
  assert.equal(accountState(row({ plan: "complimentary", paid_until: "2020-01-01T00:00:00Z" }), NOW), "complimentary");
  assert.equal(accountState(row({ status: "suspended", plan: "trial" }), NOW), "suspended");
  assert.equal(accountState(row({ status: "cancelled" }), NOW), "cancelled");
});

test("AI cost uses per-million-token prices", () => {
  assert.equal(aiCostUsd(1_000_000, 0, { input: 3, output: 15 }), 3);
  assert.equal(aiCostUsd(2_000_000, 100_000, { input: 3, output: 15 }), 7.5);
  if (!process.env.AI_PRICE_INPUT_PER_MTOK) assert.equal(aiCostUsd(1_000_000, 100_000), 3, "Sonnet 5 defaults: $2 in, $10 out");
});

test("health issues", () => {
  assert.deepEqual(healthIssues(row(), "active", NOW), []);
  assert.deepEqual(healthIssues(row({ failed_crm_syncs: 2, tool_errors: 1 }), "active", NOW), ["2 CRM sync failed", "1 tool error"]);
  assert.deepEqual(healthIssues(row({ last_activity_at: "2026-10-20T00:00:00Z" }), "active", NOW), ["Quiet for 7+ days"]);
  assert.deepEqual(healthIssues(row({ last_activity_at: null, listings_count: 0 }), "trial", NOW), ["No listings", "No conversations yet"]);
  // 0050: failures, calendars, a paused trial, AI cost against price.
  assert.deepEqual(healthIssues(row({ failures_7d: 3, calendar_problems: 1 }), "active", NOW), ["3 failures this week", "1 calendar Elliot can't book into"]);
  assert.deepEqual(healthIssues(row({ plan: "trial" }), "trial_ended", NOW), ["Elliot paused: trial ended"]);
  if (!process.env.AI_PRICE_INPUT_PER_MTOK) {
    assert.deepEqual(healthIssues(row({ monthly_price: 100, input_tokens: 15_000_000, output_tokens: 0 }), "active", NOW), ["AI cost 30% of their price"]);
    assert.deepEqual(healthIssues(row({ monthly_price: 100, input_tokens: 10_000_000, output_tokens: 0 }), "active", NOW), []);
    assert.equal(totalAiCostUsd([row({ input_tokens: 1_000_000 }), row({ output_tokens: 1_000_000 })]), 12);
  }
  // Cancelled agencies being quiet is not a problem.
  assert.deepEqual(healthIssues(row({ last_activity_at: null }), "cancelled", NOW), []);
});

test("monthly revenue counts only active paying agencies", () => {
  const rows = [
    row({ monthly_price: 199 }),
    row({ monthly_price: "249.00" }),
    row({ monthly_price: 199, paid_until: "2026-10-01T00:00:00Z" }), // past due
    row({ monthly_price: 199, plan: "trial" }),
    row({ monthly_price: null }),
  ];
  assert.equal(monthlyRevenue(rows, NOW), 448);
});

test("relative days", () => {
  assert.equal(relativeDays("2026-11-12T12:00:00Z", NOW), "in 5 days");
  assert.equal(relativeDays("2026-10-27T12:00:00Z", NOW), "11 days ago");
  assert.equal(relativeDays("2026-11-08T12:00:00Z", NOW), "tomorrow");
});
