import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ACCOUNT_STATE_LABEL,
  accountState,
  aiCostUsd,
  healthIssues,
  type TenantOverviewRow,
} from "@/lib/platform";
import { Badge, Panel, formatDate, humanize, timeAgo } from "../../../../_ui/ui";
import TenantForm from "./tenant-form";
import ViewAsButton from "./view-as-button";
import { describeEvent } from "@/lib/platform-events";
import BackButton from "@/app/_ui/back-button";
import { supportAccessState, untilLabel } from "@/lib/support-access";

export const dynamic = "force-dynamic";

const n = (v: number | string | null | undefined) => Number(v || 0);

export default async function TenantDetailPage({ params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const [{ data: overview }, { data: tenant }, { data: users }, { data: errors }, { data: crmFailures }, { data: events }, { data: grant }, { data: visits }, { data: settings }] =
    await Promise.all([
      admin.rpc("platform_tenant_overview", { p_days: 30 }),
      admin
        .from("tenants")
        .select("id, name, slug, industry, plan, status, timezone, created_at, trial_ends_at, paid_until, monthly_price, contact_email, notes, assistant_mode")
        .eq("id", params.id)
        .maybeSingle(),
      admin
        .from("tenant_users")
        .select("id, email, full_name, role, created_at")
        .eq("tenant_id", params.id)
        .order("created_at"),
      admin
        .from("tool_call_log")
        .select("id, tool_name, error, requested_at")
        .eq("tenant_id", params.id)
        .not("error", "is", null)
        .order("requested_at", { ascending: false })
        .limit(5),
      admin
        .from("crm_sync_log")
        .select("id, entity_type, last_error, updated_at")
        .eq("tenant_id", params.id)
        .eq("status", "failed")
        .order("updated_at", { ascending: false })
        .limit(5),
      admin
        .from("audit_log")
        .select("id, actor_id, event_type, details, created_at")
        .eq("tenant_id", params.id)
        .order("created_at", { ascending: false })
        .limit(10),
      // 0040: whether the agency lets support into its dashboard, and what was opened.
      admin.from("support_access_grants").select("expires_at, granted_by_email, granted_at").eq("tenant_id", params.id).maybeSingle(),
      admin
        .from("support_access_log")
        .select("id, admin_email, section, viewed_at")
        .eq("tenant_id", params.id)
        .order("viewed_at", { ascending: false })
        .limit(8),
      admin.from("platform_settings").select("support_permission_required").maybeSingle(),
    ]);

  if (!tenant) notFound();
  const row = ((overview ?? []) as TenantOverviewRow[]).find((r) => r.tenant_id === params.id);
  const state = row ? accountState(row) : accountState(tenant as any);
  const issues = row ? healthIssues(row, state) : [];
  const access = supportAccessState(grant, (tenant as any).assistant_mode, new Date(), settings?.support_permission_required ?? true);

  const usage = row
    ? [
        ["Conversations", n(row.conversations_count)],
        ["New leads", n(row.leads_count)],
        ["Hot leads now", n(row.hot_leads_count)],
        ["Viewings booked", n(row.appointments_count)],
        ["Open escalations", n(row.open_escalations)],
        ["Emails awaiting approval", n(row.pending_approvals)],
        ["AI replies", n(row.ai_replies)],
        ["AI cost", `$${aiCostUsd(n(row.input_tokens), n(row.output_tokens)).toFixed(2)}`],
      ]
    : [];

  return (
    <div>
      <BackButton fallback="/platform" />
      <div className="mb-6 mt-1 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="m-0 text-[22px] font-semibold tracking-[-0.01em] text-ink">{tenant.name}</h1>
          <Badge tone={state === "past_due" || state === "trial_ended" ? "alert" : state === "trial" ? "brass" : "ink"}>
            {ACCOUNT_STATE_LABEL[state]}
          </Badge>
        </div>
        <ViewAsButton tenantId={tenant.id} tenantName={tenant.name} allowed={access.open} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 content-start gap-6">
          <Panel title="Account and billing">
            <TenantForm tenant={tenant as any} />
          </Panel>

          <Panel title="Last 30 days">
            <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              {usage.map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-[12.5px] text-gray-500">{label}</dt>
                  <dd className="tabular m-0 text-[20px] font-semibold text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title="Recent problems" flush>
            {issues.length === 0 && !errors?.length && !crmFailures?.length ? (
              <p className="m-0 px-5 py-4 text-[13px] text-gray-500">Nothing wrong that Elliot can see.</p>
            ) : (
              <ul className="m-0 list-none p-0 text-[13px]">
                {issues.map((i) => (
                  <li key={i} className="border-t border-gray-100 px-5 py-3 first:border-t-0 text-alert">
                    {i}
                  </li>
                ))}
                {(errors ?? []).map((e: any) => (
                  <li key={e.id} className="border-t border-gray-100 px-5 py-3 first:border-t-0">
                    <span className="font-medium text-ink">{e.tool_name}</span>{" "}
                    <span className="text-gray-500">{timeAgo(e.requested_at)}</span>
                    <div className="break-words text-gray-600">{e.error}</div>
                  </li>
                ))}
                {(crmFailures ?? []).map((c: any) => (
                  <li key={c.id} className="border-t border-gray-100 px-5 py-3 first:border-t-0">
                    <span className="font-medium text-ink">CRM sync ({c.entity_type})</span>{" "}
                    <span className="text-gray-500">{timeAgo(c.updated_at)}</span>
                    <div className="break-words text-gray-600">{c.last_error || "Failed"}</div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="grid content-start gap-6">
          <Panel title="Details">
            <dl className="m-0 grid gap-3 text-[13px]">
              {[
                ["Slug (widget id)", tenant.slug],
                ["Industry", tenant.industry ? humanize(tenant.industry) : null],
                ["Time zone", tenant.timezone],
                ["Joined", formatDate(tenant.created_at)],
                ["Last activity", row?.last_activity_at ? timeAgo(row.last_activity_at) : "Never"],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-gray-500">{label}</dt>
                  <dd className="m-0 break-words text-ink">{value || <span className="text-gray-400">–</span>}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title="Support access">
            <p className="m-0 text-[13px] text-ink">
              {access.open
                ? access.reason === "own_account"
                  ? "Elliot's own account: open with two-step sign-in."
                  : access.reason === "not_required"
                    ? "Open: the agency's permission isn't required yet (testing). Turn it on under Agencies before real clients."
                    : `Allowed until ${untilLabel(access.until, tenant.timezone || undefined)}${access.by ? ` by ${access.by}` : ""}.`
                : access.reason === "expired"
                  ? `Off. Their last permission ended ${timeAgo(access.expiredAt!)}.`
                  : "Off. Their dashboard and clients' data stay closed to you."}
            </p>
            {!access.open && (
              <p className="m-0 mt-1 text-[12.5px] text-gray-500">
                They can allow it for 24 hours, 7 days or 30 days in Settings → Elliot support access, and see each part you open.
              </p>
            )}
            {!!visits?.length && (
              <ul className="m-0 mt-3 list-none border-t border-gray-100 p-0 pt-2 text-[12.5px] text-gray-600">
                {visits.map((v: any) => (
                  <li key={v.id} className="py-0.5">
                    {v.section} <span className="text-gray-400">· {timeAgo(v.viewed_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={`Team (${users?.length ?? 0})`} flush>
            <ul className="m-0 list-none p-0 text-[13px]">
              {(users ?? []).map((u: any) => (
                <li key={u.id} className="flex items-center justify-between gap-3 border-t border-gray-100 px-5 py-3 first:border-t-0">
                  <span className="min-w-0">
                    <span className="block truncate text-ink">{u.full_name || u.email}</span>
                    {u.full_name && <span className="block truncate text-[12px] text-gray-500">{u.email}</span>}
                  </span>
                  <Badge tone={u.role === "admin" ? "ink" : "neutral"}>{humanize(u.role)}</Badge>
                </li>
              ))}
              {!users?.length && <li className="px-5 py-3 text-gray-500">No users yet.</li>}
            </ul>
          </Panel>

          <Panel title="Activity" flush>
            <ul className="m-0 list-none p-0 text-[13px]">
              {(events ?? []).map((e: any) => (
                <li key={e.id} className="border-t border-gray-100 px-5 py-3 first:border-t-0">
                  <div className="text-ink">{describeEvent(e.event_type, e.details)}</div>
                  <div className="text-[12px] text-gray-500">
                    {e.actor_id || "System"} · {timeAgo(e.created_at)}
                  </div>
                </li>
              ))}
              {!events?.length && <li className="px-5 py-3 text-gray-500">No changes recorded yet.</li>}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
