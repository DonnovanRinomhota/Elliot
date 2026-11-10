import { createClient } from "@/lib/supabase/server";
import LeadCard, { type RunningRun, type StartableSequence } from "./lead-card";
import { LEAD_GRID } from "./grid";
import { EmptyState, PageHeader, Pagination, paginate } from "../../../_ui/ui";
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
  searchParams: { status?: string; days?: string; owner?: string; page?: string };
}) {
  const supabase = createClient();

  const [{ data: leads, error }, { data: sequences }, { data: runningRuns }, { data: waChats }] = await Promise.all([
    supabase
      .from("leads")
      .select("id, tenant_id, contact_id, status, score, qualification_answers, intent, created_at, assigned_to, owner:tenant_users(full_name, email), contact:contacts(name, email, phone)")
      .order("created_at", { ascending: false }),
    // For "Start follow-up": only active sequences can take new leads.
    supabase.from("follow_up_sequences").select("id, name, steps").eq("is_active", true).order("created_at"),
    supabase.from("follow_up_runs").select("id, lead_id, sequence:follow_up_sequences(name)").eq("status", "running"),
    // 0045: clients who wrote on WhatsApp can get follow-ups there.
    supabase.from("conversations").select("contact_id").eq("channel", "whatsapp"),
  ]);
  const onWhatsApp = new Set(((waChats ?? []) as { contact_id: string | null }[]).map((c) => c.contact_id));

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
  const owner = searchParams.owner || null;
  const byDate = cutoff ? (leads ?? []).filter((l: any) => new Date(l.created_at).getTime() >= cutoff) : leads ?? [];
  // ?owner= comes from the Team page's "open leads" figure.
  const scoped = owner ? byDate.filter((l: any) => l.assigned_to === owner && !["CONVERTED", "LOST"].includes(l.status)) : byDate;
  const ownerRow: any = owner ? (scoped[0] as any)?.owner : null;

  const tabs: FolderTab[] = [
    { key: "all", label: "All", count: scoped.length, tone: "neutral" },
    ...STATUS_TABS.map((t) => ({ ...t, count: scoped.filter((l: any) => l.status === t.key).length })),
  ];

  const activeStatus = tabs.some((t) => t.key === searchParams.status) ? (searchParams.status as string) : "all";
  const visible = activeStatus === "all" ? scoped : scoped.filter((l: any) => l.status === activeStatus);
  const pg = paginate(visible, searchParams.page);

  return (
    <div>
      <PageHeader
        title="Leads"
        description={
          owner ? (
            <>
              {scoped.length} open lead{scoped.length === 1 ? "" : "s"} owned by {ownerRow?.full_name || ownerRow?.email || "this person"}.{" "}
              <a href="/dashboard/leads" className="text-ink underline">
                Show all
              </a>
            </>
          ) : days ? (
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
        tabs={
          <FolderTabs tabs={tabs} activeKey={activeStatus} basePath="/dashboard/leads" extraParams={{ ...(days ? { days: String(days) } : {}), ...(owner ? { owner } : {}) }} />
        }
      />

      {visible.length === 0 ? (
        <EmptyState title="No leads here">Leads appear as soon as Elliot qualifies someone in a conversation.</EmptyState>
      ) : (
        <div className="overflow-hidden card">
          <div className={`hidden border-b border-gray-200 bg-gray-50 px-5 py-2.5 text-[12px] font-medium text-gray-500 ${LEAD_GRID}`}>
            <span>#</span>
            <span>Contact</span>
            <span>Stage</span>
            <span>Score</span>
            <span>Follow-up</span>
            <span>Added</span>
            <span className="sr-only">Actions</span>
          </div>
          <ul className="m-0 list-none p-0">
            {pg.items.map((lead: any, i: number) => (
              <LeadCard
                key={lead.id}
                number={pg.offset + i + 1}
                lead={lead}
                sequences={startableSequences}
                runningRun={runByLead.get(lead.id) ?? null}
                onWhatsApp={onWhatsApp.has((lead as any).contact_id)}
              />
            ))}
          </ul>
        </div>
      )}
      <Pagination
        {...pg}
        shown={pg.items.length}
        basePath="/dashboard/leads"
        params={{ days: days ? String(days) : undefined, owner: owner ?? undefined, status: activeStatus === "all" ? undefined : activeStatus }}
        noun="leads"
      />
    </div>
  );
}
