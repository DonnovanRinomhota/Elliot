import { createAdminClient } from "@/lib/supabase/admin";
import { accountState, monthlyRevenue, type AccountState, type TenantOverviewRow } from "@/lib/platform";
import { PageHeader } from "../../_ui/ui";
import AgenciesTable from "./agencies-table";

export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  // The layout has already checked ADMIN_EMAILS. This reads across every
  // tenant, which is why it needs the service role.
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("platform_tenant_overview", { p_days: 30 });
  const rows = (data ?? []) as TenantOverviewRow[];

  const now = new Date();
  const counts: Record<AccountState, number> = {
    trial: 0, trial_ended: 0, active: 0, past_due: 0, complimentary: 0, suspended: 0, cancelled: 0,
  };
  rows.forEach((r) => counts[accountState(r, now)]++);
  const mrr = monthlyRevenue(rows, now);

  const tiles: { label: string; value: string | number; tone?: "alert" | "brass"; filter?: string }[] = [
    { label: "Agencies", value: rows.length, filter: "" },
    { label: "Free trial", value: counts.trial, filter: "trial" },
    { label: "Active", value: counts.active, filter: "active" },
    { label: "Past due", value: counts.past_due, tone: counts.past_due ? "alert" : undefined, filter: "past_due" },
    { label: "Trial ended", value: counts.trial_ended, tone: counts.trial_ended ? "brass" : undefined, filter: "trial_ended" },
    { label: "Complimentary", value: counts.complimentary, filter: "complimentary" },
    { label: "Monthly revenue", value: `€${mrr.toLocaleString("en-GB", { maximumFractionDigits: 0 })}` },
  ];

  return (
    <div>
      <PageHeader
        title="Agencies"
        description="Every agency on Elliot: where their account stands, how much they use it and whether anything needs a look. Figures cover the last 30 days."
      />

      {error && (
        <p className="mb-4 text-[13px] text-alert">
          Couldn&apos;t load agencies: {error.message}. Has migration 0027 been run, and is SUPABASE_SERVICE_ROLE_KEY set?
        </p>
      )}

      <section aria-label="Summary" className="mb-6 grid grid-cols-2 overflow-hidden rounded-lg border border-gray-200 bg-white sm:grid-cols-4 lg:grid-cols-7">
        {tiles.map((t, i) => (
          <div key={t.label} className={`px-4 py-4 ${i > 0 ? "border-l border-gray-200" : ""} max-lg:[&:nth-child(n+5)]:border-t max-sm:[&:nth-child(n+3)]:border-t max-sm:[&:nth-child(odd)]:border-l-0`}>
            <div
              className={`tabular text-[26px] font-semibold leading-none tracking-[-0.02em] ${
                t.tone === "alert" ? "text-alert" : t.tone === "brass" ? "text-brass-dark" : "text-ink"
              }`}
            >
              {t.value}
            </div>
            <div className="mt-2 text-[12.5px] text-gray-500">{t.label}</div>
          </div>
        ))}
      </section>

      <AgenciesTable rows={rows} />
    </div>
  );
}
