import { createClient } from "@/lib/supabase/server";
import EscalationCard from "./escalation-card";
import FolderTabs, { FolderTab } from "../folder-tabs";
import { EmptyState, FilterDescription, PageHeader, Pagination, paginate } from "../../../_ui/ui";

// Matches escalation-card.tsx's updateStatus() targets exactly.
const STATUS_TABS: FolderTab[] = [
  { key: "open", label: "Open", count: 0, tone: "danger" },
  { key: "acknowledged", label: "Acknowledged", count: 0, tone: "warning" },
  { key: "resolved", label: "Resolved", count: 0, tone: "success" },
];

export default async function EscalationsPage({
  searchParams,
}: {
  searchParams: { status?: string; days?: string; page?: string };
}) {
  const supabase = createClient();

  const { data: escalations, error } = await supabase
    .from("escalations")
    .select("id, conversation_id, reason, priority, context_summary, status, created_at, resolved_at")
    .order("created_at", { ascending: false });

  if (error) {
    return <p className="text-[13px] text-alert">Couldn&apos;t load escalations: {error.message}</p>;
  }

  const days = searchParams.days ? Number(searchParams.days) : null;
  const cutoff = days ? Date.now() - days * 24 * 60 * 60 * 1000 : null;
  const scoped = cutoff ? (escalations ?? []).filter((e: any) => new Date(e.created_at).getTime() >= cutoff) : escalations ?? [];

  const tabs: FolderTab[] = [
    { key: "all", label: "All", count: scoped.length, tone: "neutral" },
    ...STATUS_TABS.map((t) => ({ ...t, count: scoped.filter((e: any) => e.status === t.key).length })),
  ];

  const activeStatus = tabs.some((t) => t.key === searchParams.status) ? (searchParams.status as string) : "all";
  const visible = activeStatus === "all" ? scoped : scoped.filter((e: any) => e.status === activeStatus);
  const pg = paginate(visible, searchParams.page);

  return (
    <div>
      <PageHeader
        title="Escalations"
        description={
          <FilterDescription days={days} count={scoped.length} noun={["escalation", "escalations"]} clearHref="/dashboard/escalations">
            Conversations Elliot handed to a person. Acknowledge one when you&apos;ve picked it up, resolve it when it&apos;s done.
          </FilterDescription>
        }
      />

      <FolderTabs
        tabs={tabs}
        activeKey={activeStatus}
        basePath="/dashboard/escalations"
        extraParams={days ? { days: String(days) } : {}}
      />

      {visible.length === 0 ? (
        <EmptyState title="Nothing to handle">When Elliot needs a person to step in, the conversation appears here.</EmptyState>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {pg.items.map((escalation: any) => (
            <EscalationCard key={escalation.id} escalation={escalation} />
          ))}
        </ul>
      )}
      <Pagination
        {...pg}
        shown={pg.items.length}
        basePath="/dashboard/escalations"
        params={{ days: days ? String(days) : undefined, status: activeStatus === "all" ? undefined : activeStatus }}
        noun="escalations"
      />
    </div>
  );
}
