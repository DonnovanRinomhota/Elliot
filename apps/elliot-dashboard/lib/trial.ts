// What an agency's own dashboard says about its trial (0050). Pure, so it can
// be unit tested (lib/trial.test.ts). The pause itself happens in the database
// (tenant_service_state) and workflow 01; this only tells the agency.

export type TrialFields = {
  plan: string | null;
  status: string | null;
  trial_started_at: string | null;
  trial_ends_at: string | null;
};

export type TrialBanner = { tone: "info" | "warning" | "alert"; text: string } | null;

const DAY = 86_400_000;

export function trialBanner(t: TrialFields | null, now: Date = new Date()): TrialBanner {
  if (!t) return null;
  if (t.status === "suspended") {
    return { tone: "alert", text: "Elliot is paused for your agency. Clients get a short holding reply and their messages are in your inbox. Contact Donnovan to switch it back on." };
  }
  // Only trials started from the control panel count (0050).
  if (t.plan !== "trial" || !t.trial_started_at || !t.trial_ends_at) return null;
  const ends = new Date(t.trial_ends_at);
  if (Number.isNaN(ends.getTime())) return null;
  const date = ends.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  if (ends <= now) {
    return {
      tone: "alert",
      text: `Your free trial ended on ${date}. Elliot is paused: clients get a short holding reply and their messages are in your inbox. Contact Donnovan to continue.`,
    };
  }
  const days = Math.ceil((ends.getTime() - now.getTime()) / DAY);
  const left = days <= 1 ? "Last day" : `${days} days left`;
  return { tone: days <= 2 ? "warning" : "info", text: `Free trial: ${left} (ends ${date}).` };
}
