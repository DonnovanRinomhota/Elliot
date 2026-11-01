import { createClient } from "@/lib/supabase/server";
import LeadCard, { type RunningRun, type StartableSequence } from "./lead-card";
import { LEAD_GRID } from "./grid";
import { EmptyState, PageHeader } from "../../../_ui/ui";
import FolderTabs, { FolderTab } from "../folder-tabs";

// Real values confirmed via leads_status_check constraint (see lead-card.tsx).
const STATUS_TABS: FolderTab[] = [
  { key: "NEW", label: "New", count: 0, tone: "info" },
  { key: "QUALIFYING", label: "Qualifying", count: 0, tone: "info" },
  { key: "WARM", label: "Warm", count: 0, tone: "warning" },
  { key: "HOT", label: "Hot", count: 0, tone: "danger" },
  { key: "COLD", label: "Cold", count: 0, tone: "neutral" },
  { key: "CONVERTED", label: "Converted", count: 0, tone: "success" },
  { key: "LOST", label: "Lost", count: 0, tone: "neutral" },
];

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: { status?: string; days?: string };
}) {
  const supabase = createClient();

  const [{ data: leads, error }, { data: sequences }, { data: runningRuns }] = await Promise.all([
    supabase
      .from("leads")
      .select("id, tenant_id, status, score, qualification_answers, created_at, contact:contacts(name, email, phone)")
      .order("created_at", { ascending: false }),
    // For "Start follow-up": only active sequences can take new leads.
    supabase.from("follow_up_sequences").select("id, name, steps").eq("is_active", true).order("created_at"),
    supabase.from("follow_up_runs").select("id, lead_id, sequence:follow_up_sequences(name)").eq("status", "running"),
  ]);

  if (error) {
    return <p className="text-[13px] text-alert">Failed to load leads: {error.message}</p>;
  }

  const startableSequences: StartableSequence[] = (sequences ?? [])
    .filter((s: any) => Array.isArray(s.steps) && s.steps.length > 0)
    .map((s: any) => ({ id: s.id, name: s.name, firstDayOffset: Number(s.steps[0]?.day_offset ?? 0) }));

  const runByLead = new Map<string, RunningRun>();
  for (const r of (runningRuns ?? []) as any[]) {
    if (!runByLead.has(r.lead_id)) runByLead.set(r.lead_id, { id: r.id, sequenceName: r.sequence?.name ?? "a sequence" });
  }

  const days = searchParams.days ? Number(searchParams.days) : null;
  const cutoff = days ? Date.now() - days * 24 * 60 * 60 * 1000 : null;
  const scoped = cutoff ? (leads ?? []).filter((l: any) => new Date(l.created_at).getTime() >= cutoff) : leads ?? [];

  const tabs: FolderTab[] = [
    { key: "all", label: "All", count: scoped.length, tone: "neutral" },
    ...STATUS_TABS.map((t) => ({ ...t, count: scoped.filter((l: any) => l.status === t.key).length })),
  ];

  const activeStatus = tabs.some((t) => t.key === searchParams.status) ? (searchParams.status as string) : "all";
  const visible = activeStatus === "all" ? scoped : scoped.filter((l: any) => l.status === activeStatus);

  return (
    <div>
      <PageHeader
        title="Leads"
        description={
          days ? (
            <>
              {scoped.length} lead{scoped.length === 1 ? "" : "s"} from the last {days} days.{" "}
              <a href="/dashboard/leads" className="text-ink underline">
                Show all
              </a>
            </>
          ) : (
            "Everyone Elliot has spoken to, with their stage and score. Change a stage from the list; open Details for the score breakdown and follow-ups."
          )
        }
      />

      <FolderTabs tabs={tabs} activeKey={activeStatus} basePath="/dashboard/leads" extraParams={days ? { days: String(days) } : {}} />

      {visible.length === 0 ? (
        <EmptyState title="No leads here">Leads appear as soon as Elliot qualifies someone in a conversation.</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className={`hidden border-b border-gray-200 bg-gray-50 px-5 py-2.5 text-[12px] font-medium text-gray-500 ${LEAD_GRID}`}>
            <span>Contact</span>
            <span>Stage</span>
            <span>Score</span>
            <span>Follow-up</span>
            <span>Added</span>
            <span className="sr-only">Actions</span>
          </div>
          <ul className="m-0 list-none p-0">
            {visible.map((lead: any) => (
              <LeadCard key={lead.id} lead={lead} sequences={startableSequences} runningRun={runByLead.get(lead.id) ?? null} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
