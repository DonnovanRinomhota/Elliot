import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SequencesManager, { type RunCounts, type SequenceRow } from "./sequences-manager";

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
    return <p className="text-sm text-red-700">No tenant found for this account.</p>;
  }

  // RLS scopes all three to the logged-in user's tenant, same assumption the
  // rest of the dashboard relies on.
  const [{ data: sequences, error }, { data: runs }, { data: aiConfig }] = await Promise.all([
    supabase
      .from("follow_up_sequences")
      .select("id, name, is_active, steps")
      .order("created_at", { ascending: true }),
    // Aggregated in JS: a pilot tenant has far fewer than PostgREST's default
    // 1000-row cap. If that ever stops being true, move this to an RPC like
    // get_revenue_dashboard_stats() rather than paginating here.
    supabase.from("follow_up_runs").select("sequence_id, status"),
    supabase.from("ai_config").select("autonomy_rules").eq("tenant_id", tenantUser.tenant_id).single(),
  ]);

  if (error) {
    return <p className="text-sm text-red-700">Failed to load follow-up sequences: {error.message}</p>;
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
      <h1 className="mb-1 text-xl font-bold text-ink">Follow-ups</h1>
      <p className="mb-4 max-w-2xl text-sm text-gray-500">
        Emails Elliot sends on a schedule after a lead is added to a sequence. A sequence stops for a lead as soon as
        they reply.
      </p>

      <div className="mb-6 flex max-w-2xl flex-col gap-2">
        <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
          {autonomous
            ? "Each step is sent automatically, with no review. "
            : "Each step waits in Approvals for you to review before it sends. "}
          You can change this under{" "}
          <a href="/dashboard/settings" className="text-ink underline">
            Settings
          </a>
          , in Automation rules.
        </p>
        <p className="rounded-md bg-amber-soft px-3 py-2 text-xs text-amber-dark">
          Adding a lead to a sequence isn&apos;t automatic yet. It&apos;s still a manual step, so a sequence you create
          here won&apos;t send anything until a lead is added to it. Sequences that have been used can be deactivated
          but not deleted, so their history stays intact.
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
