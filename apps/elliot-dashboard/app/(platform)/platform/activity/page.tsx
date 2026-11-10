import { createAdminClient } from "@/lib/supabase/admin";
import { EmptyState, PageHeader, Pagination, formatDate, paginate } from "../../../_ui/ui";
import { describeEvent } from "@/lib/platform-events";

export const dynamic = "force-dynamic";

// Control-panel and team changes across all agencies (audit_log events
// written by the dashboard, actor_type 'system').
export default async function ActivityPage({ searchParams }: { searchParams: { page?: string } }) {
  const admin = createAdminClient();
  const { data: events, error } = await admin
    .from("audit_log")
    .select("id, tenant_id, actor_id, event_type, details, created_at, tenant:tenants(name)")
    .or("event_type.like.platform.%,event_type.like.team.%,event_type.like.support.%")
    .order("created_at", { ascending: false })
    .limit(1200);
  const pg = paginate(events ?? [], searchParams.page);

  return (
    <div>
      <PageHeader title="Activity log" description="Who changed what: plans, statuses, payments, dashboard visits, support access and team changes." />
      {error && <p className="text-[13px] text-alert">Couldn&apos;t load: {error.message}</p>}
      {!events?.length ? (
        <EmptyState title="Nothing recorded yet">Changes you make in the control panel will show up here.</EmptyState>
      ) : (
        <div className="overflow-x-auto card">
          <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-gray-200 text-[12px] text-gray-500">
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-4 py-2.5 font-medium">Agency</th>
                <th className="px-4 py-2.5 font-medium">What</th>
                <th className="px-4 py-2.5 font-medium">By</th>
              </tr>
            </thead>
            <tbody>
              {pg.items.map((e: any) => (
                <tr key={e.id} className="border-b border-gray-100 last:border-b-0">
                  <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                    {formatDate(e.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-3">
                    {e.tenant_id ? (
                      <a href={`/platform/tenants/${e.tenant_id}`} className="text-ink no-underline hover:underline">
                        {e.tenant?.name ?? "Unknown"}
                      </a>
                    ) : (
                      "–"
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink">
                    {describeEvent(e.event_type, e.details)}
                    {e.event_type === "platform.tenant_updated" && e.details?.changes && (
                      <div className="text-[12px] text-gray-500">
                        {Object.entries(e.details.changes as Record<string, { from: unknown; to: unknown }>)
                          .map(([k, v]) => `${k}: ${fmt(v.from)} → ${fmt(v.to)}`)
                          .join(" · ")}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{e.actor_id || "System"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination {...pg} shown={pg.items.length} basePath="/platform/activity" noun="changes" />
    </div>
  );
}

function fmt(v: unknown) {
  if (v == null || v === "") return "none";
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}T/.test(s) ? s.slice(0, 10) : s;
}
