import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SequencesManager, { type RunCounts, type SequenceRow } from "./sequences-manager";
import { PageHeader } from "../../../_ui/ui";

export default async function FollowUpsPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: tenantUser } = await supabase
    .from("tenant_users")
    .select("tenant_id")
    .eq("auth_user_id", user.id)
    .single();

  if (!tenantUser) {
    return <p className="text-[13px] text-alert">No tenant found for this account.</p>;
  }

  // RLS scopes all three to the logged-in user's tenant, same assumption the
  // rest of the dashboard relies on.
  const [{ data: sequences, error }, { data: runs }, { data: aiConfig }] = await Promise.all([
    supabase
      .from("follow_up_sequences")
      .select("id, name, is_active, steps, auto_enrol, auto_enrol_after_hours")
      .order("created_at", { ascending: true }),
    // Aggregated in JS: a pilot tenant has far fewer than PostgREST's default
    // 1000-row cap. If that ever stops being true, move this to an RPC like
    // get_revenue_dashboard_stats() rather than paginating here.
    supabase.from("follow_up_runs").select("sequence_id, status"),
    supabase.from("ai_config").select("autonomy_rules").eq("tenant_id", tenantUser.tenant_id).single(),
  ]);

  if (error) {
    return <p className="text-[13px] text-alert">Failed to load follow-up sequences: {error.message}</p>;
  }

  const runCounts: Record<string, RunCounts> = {};
  for (const run of runs ?? []) {
    const counts = (runCounts[run.sequence_id] ??= { running: 0, completed: 0, stopped: 0 });
    if (run.status === "running") counts.running++;
    else if (run.status === "completed") counts.completed++;
    else if (run.status === "stopped") counts.stopped++;
  }

  // Same default the sweep uses: anything other than an explicit "autonomous" needs approval.
  const autonomous = aiConfig?.autonomy_rules?.send_follow_up?.mode === "autonomous";

  return (
    <div>
      <PageHeader
        title="Follow-ups"
        description="Email sequences Elliot sends after a conversation goes quiet. A sequence stops as soon as the lead replies."
      />

      <div className="mb-6 grid max-w-3xl gap-1 text-[13px] text-gray-600">
        <p className="m-0">
          {autonomous ? "Each step sends automatically, without review." : "Each step waits in Approvals until you approve it."}{" "}
          Change this in{" "}
          <a href="/dashboard/settings" className="text-ink underline">
            Settings
          </a>
          .
        </p>
        <p className="m-0">
          Leads join a sequence automatically if auto-enrol is on, or when you press Start follow-up on a lead in{" "}
          <a href="/dashboard/leads" className="text-ink underline">
            Leads
          </a>
          . Leads without an email address are skipped.
        </p>
      </div>

      <SequencesManager
        tenantId={tenantUser.tenant_id}
        sequences={(sequences ?? []) as SequenceRow[]}
        runCounts={runCounts}
      />
    </div>
  );
}
