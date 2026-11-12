import { createAdminClient } from "@/lib/supabase/admin";
import { EmptyState, PageHeader, Pagination, paginate, timeAgo } from "../../../_ui/ui";
import { PROBLEM_FILTER, describeProblem, groupProblems, problemDetail } from "@/lib/problems";

export const dynamic = "force-dynamic";

// Every failure Elliot recorded across agencies in the last 14 days, in plain
// words, with what to do (0050). The same events the health alerts email you
// about, so you don't have to go through n8n's executions one by one.
export default async function ProblemsPage({ searchParams }: { searchParams: { page?: string } }) {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data, error } = await admin
    .from("audit_log")
    .select("id, tenant_id, event_type, details, created_at, tenant:tenants(name)")
    .or(PROBLEM_FILTER)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1000);
  const rows = (data ?? []) as unknown as {
    id: string;
    tenant_id: string | null;
    event_type: string;
    details: Record<string, unknown> | null;
    created_at: string;
    tenant: { name: string } | null;
  }[];
  const groups = groupProblems(rows);
  const pg = paginate(rows, searchParams.page);

  return (
    <div>
      <PageHeader
        title="Problems"
        description="Everything that failed in the last 14 days, across all agencies, and what to do about it. The health check emails you about the same events every 15 minutes."
      />
      {error && <p className="text-[13px] text-alert">Couldn&apos;t load: {error.message}</p>}

      {!rows.length ? (
        <EmptyState title="Nothing failed in the last 14 days">Failed replies, bookings, deliveries and workflow crashes show up here.</EmptyState>
      ) : (
        <>
          <section aria-label="By kind" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => {
              const k = describeProblem(g.event_type);
              return (
                <div key={g.event_type} className="card px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13.5px] font-medium text-ink">{k.what}</span>
                    <span className="tabular text-[18px] font-semibold text-alert">{g.count}</span>
                  </div>
                  <p className="m-0 mt-1 text-[12.5px] leading-snug text-gray-500">{k.fix}</p>
                </div>
              );
            })}
          </section>

          <div className="overflow-x-auto card">
            <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-gray-200 text-[12px] text-gray-500">
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="px-4 py-2.5 font-medium">Agency</th>
                  <th className="px-4 py-2.5 font-medium">What happened</th>
                  <th className="px-4 py-2.5 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {pg.items.map((r) => {
                  const url = typeof r.details?.execution_url === "string" ? r.details.execution_url : null;
                  return (
                    <tr key={r.id} className="border-b border-gray-100 align-top last:border-b-0">
                      <td className="whitespace-nowrap px-4 py-3 text-gray-500" title={new Date(r.created_at).toLocaleString("en-GB")}>
                        {timeAgo(r.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        {r.tenant_id ? (
                          <a href={`/platform/tenants/${r.tenant_id}`} className="text-ink no-underline hover:underline">
                            {r.tenant?.name ?? "Agency"}
                          </a>
                        ) : (
                          <span className="text-gray-500">Platform</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-ink">{describeProblem(r.event_type).what}</td>
                      <td className="max-w-[420px] break-words px-4 py-3 text-gray-600">
                        {problemDetail(r.details) || <span className="text-gray-400">–</span>}
                        {url && /^https:\/\//.test(url) && (
                          <a href={url} target="_blank" rel="noreferrer" className="ml-2 whitespace-nowrap text-[12.5px]">
                            Open in n8n
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination {...pg} shown={pg.items.length} basePath="/platform/problems" noun="problems" />
        </>
      )}
    </div>
  );
}
