import { createClient } from "@/lib/supabase/server";
import EscalationCard from "./escalation-card";
import FolderTabs, { FolderTab } from "../folder-tabs";

// Matches escalation-card.tsx's updateStatus() targets exactly.
const STATUS_TABS: FolderTab[] = [
  { key: "open", label: "Open", count: 0, tone: "danger" },
  { key: "acknowledged", label: "Acknowledged", count: 0, tone: "warning" },
  { key: "resolved", label: "Resolved", count: 0, tone: "success" },
];

export default async function EscalationsPage({
  searchParams,
}: {
  searchParams: { status?: string; days?: string };
}) {
  const supabase = createClient();

  const { data: escalations, error } = await supabase
    .from("escalations")
    .select("id, conversation_id, reason, priority, context_summary, status, created_at, resolved_at")
    .order("created_at", { ascending: false });

  if (error) {
    return <p className="text-sm text-red-700">Failed to load escalations: {error.message}</p>;
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

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold text-ink">Escalations</h1>
      <p className="mb-4 text-sm text-gray-500">
        {scoped.length} total this view
        {days && (
          <>
            {" "}
            · filtered to the last {days} days ·{" "}
            <a href="/dashboard/escalations" className="text-indigo-600 hover:underline">
              clear filter
            </a>
          </>
        )}
      </p>

      <FolderTabs
        tabs={tabs}
        activeKey={activeStatus}
        basePath="/dashboard/escalations"
        extraParams={days ? { days: String(days) } : {}}
      />

      {visible.length === 0 && <p className="text-sm text-gray-400">No escalations in this folder.</p>}

      <div className="flex flex-col gap-3">
        {visible.map((escalation: any) => (
          <EscalationCard key={escalation.id} escalation={escalation} />
        ))}
      </div>
    </div>
  );
}
