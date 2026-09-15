import { createClient } from "@/lib/supabase/server";
import LeadCard from "./lead-card";
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

  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, status, score, qualification_answers, created_at, contact:contacts(name, email, phone)")
    .order("created_at", { ascending: false });

  if (error) {
    return <p className="text-sm text-red-700">Failed to load leads: {error.message}</p>;
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
      <h1 className="mb-1 text-xl font-bold text-ink">Leads</h1>
      <p className="mb-4 text-sm text-gray-500">
        {scoped.length} total this view
        {days && (
          <>
            {" "}
            · filtered to leads from the last {days} days ·{" "}
            <a href="/dashboard/leads" className="text-indigo-600 hover:underline">
              clear filter
            </a>
          </>
        )}
      </p>

      <FolderTabs tabs={tabs} activeKey={activeStatus} basePath="/dashboard/leads" extraParams={days ? { days: String(days) } : {}} />

      {visible.length === 0 && <p className="text-sm text-gray-400">No leads in this folder.</p>}

      <div className="flex flex-col gap-3">
        {visible.map((lead: any) => (
          <LeadCard key={lead.id} lead={lead} />
        ))}
      </div>
    </div>
  );
}
