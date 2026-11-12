import { createClient } from "@/lib/supabase/server";
import LeadCard, { type RunningRun, type StartableSequence } from "./lead-card";
import { LEAD_GRID } from "./grid";
import { EmptyState, PageHeader, Pagination, paginate } from "../../../_ui/ui";
import { FolderTab } from "../folder-tabs";
import { DEFAULT_TZ, dayKey, dayLabel, timeOf } from "@/lib/appointments";

// The stage colours, as on the Overview's pipeline.
const STAGE_DOT: Record<string, string> = {
  all: "#14325C",
  NEW: "#9DB7E0",
  QUALIFYING: "#6F95D1",
  WARM: "#D9A56C",
  HOT: "#F07167",
  COLD: "#B8C3D4",
  CONVERTED: "#3FBF73",
  LOST: "#D2DBE8",
};

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

  const [{ data: leads, error }, { data: sequences }, { data: runningRuns }, { data: convRows }, { data: upcoming }, { data: tenantRow }] = await Promise.all([
    supabase
      .from("leads")
      .select("id, tenant_id, contact_id, status, score, qualification_answers, intent, created_at, assigned_to, owner:tenant_users(full_name, email), contact:contacts(name, email, phone)")
      .order("created_at", { ascending: false }),
    // For "Start follow-up": only active sequences can take new leads.
    supabase.from("follow_up_sequences").select("id, name, steps").eq("is_active", true).order("created_at"),
    supabase.from("follow_up_runs").select("id, lead_id, sequence:follow_up_sequences(name)").eq("status", "running"),
    // Each client's conversations: where they first wrote, when they last did,
    // and (0045) whether they can get follow-ups on WhatsApp.
    supabase.from("conversations").select("contact_id, channel, created_at, updated_at").order("created_at"),
    // Their next viewing, for "Next step".
    supabase
      .from("appointments")
      .select("contact_id, starts_at")
      .in("status", ["confirmed", "rescheduled"])
      .gte("starts_at", new Date().toISOString())
      .order("starts_at"),
    supabase.from("tenants").select("timezone").maybeSingle(),
  ]);
  const tz = tenantRow?.timezone || DEFAULT_TZ;
  const convs = (convRows ?? []) as { contact_id: string | null; channel: string; created_at: string; updated_at: string | null }[];
  const onWhatsApp = new Set(convs.filter((c) => c.channel === "whatsapp").map((c) => c.contact_id));
  const firstChannel = new Map<string, string>();
  const lastContact = new Map<string, string>();
  for (const c of convs) {
    if (!c.contact_id) continue;
    if (!firstChannel.has(c.contact_id)) firstChannel.set(c.contact_id, c.channel);
    const at = c.updated_at || c.created_at;
    if (!lastContact.has(c.contact_id) || at > lastContact.get(c.contact_id)!) lastContact.set(c.contact_id, at);
  }
  const nextViewing = new Map<string, string>();
  for (const a of (upcoming ?? []) as { contact_id: string | null; starts_at: string }[]) {
    if (a.contact_id && !nextViewing.has(a.contact_id)) nextViewing.set(a.contact_id, `Viewing ${dayLabel(dayKey(a.starts_at, tz))} ${timeOf(a.starts_at, tz)}`);
  }

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
            "Everyone Elliot has spoken to, with their stage, score and what happens next. Change a stage from the list; open Details for the score breakdown and follow-ups."
          )
        }
      />

      {/* Stages: one card each, with how many leads are in it. */}
      <nav aria-label="Filter by stage" className="mb-5 grid grid-cols-4 gap-2 sm:gap-3 xl:grid-cols-8">
        {tabs.map((t) => {
          const on = t.key === activeStatus;
          const p = new URLSearchParams({ ...(days ? { days: String(days) } : {}), ...(owner ? { owner } : {}) });
          if (t.key !== "all") p.set("status", t.key);
          const qs = p.toString();
          const max = Math.max(1, ...tabs.slice(1).map((x) => x.count));
          return (
            <a
              key={t.key}
              href={`/dashboard/leads${qs ? `?${qs}` : ""}`}
              aria-current={on ? "page" : undefined}
              className={`card block px-2.5 py-2.5 no-underline sm:px-4 sm:py-3.5 transition-shadow hover:shadow-lift ${on ? "!border-gold ring-2 ring-gold/60" : ""}`}
            >
              <span className="flex items-center gap-1.5 truncate text-[11.5px] font-medium text-gray-600 sm:gap-2 sm:text-[13px]">
                <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: STAGE_DOT[t.key] }} />
                {t.label}
              </span>
              <span className="tabular mt-1.5 block text-[20px] font-semibold sm:text-[26px] leading-none tracking-[-0.03em] text-ink">{t.count}</span>
              <span className="mt-2.5 block h-1 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                <span className="block h-full rounded-full" style={{ width: `${t.key === "all" ? 100 : (t.count / max) * 100}%`, background: STAGE_DOT[t.key] }} />
              </span>
            </a>
          );
        })}
      </nav>

      {visible.length === 0 ? (
        <EmptyState title="No leads here">Leads appear as soon as Elliot qualifies someone in a conversation.</EmptyState>
      ) : (
        <div className="card p-3 md:p-4">
          <div className={`hidden px-3.5 pb-2 pt-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-gray-500 ${LEAD_GRID}`}>
            <span className="pl-[84px]">Lead</span>
            <span>From</span>
            <span>Stage</span>
            <span>Score</span>
            <span>Looking for</span>
            <span>Owner</span>
            <span>Next step</span>
            <span className="whitespace-nowrap text-right">Last contact</span>
            <span className="sr-only">Actions</span>
          </div>
          <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-2 p-0">
            {pg.items.map((lead: any, i: number) => (
              <LeadCard
                key={lead.id}
                number={pg.offset + i + 1}
                lead={lead}
                sequences={startableSequences}
                runningRun={runByLead.get(lead.id) ?? null}
                onWhatsApp={onWhatsApp.has((lead as any).contact_id)}
                channel={firstChannel.get((lead as any).contact_id) ?? null}
                nextViewing={nextViewing.get((lead as any).contact_id) ?? null}
                lastContact={lastContact.get((lead as any).contact_id) ?? null}
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
