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
import StartTrial from "./start-trial";
import EraseAgency from "./erase-agency";
import { PROBLEM_FILTER, describeProblem, problemDetail } from "@/lib/problems";
import { describeEvent } from "@/lib/platform-events";
import BackButton from "@/app/_ui/back-button";
import { supportAccessState, untilLabel } from "@/lib/support-access";

export const dynamic = "force-dynamic";

const n = (v: number | string | null | undefined) => Number(v || 0);

export default async function TenantDetailPage({ params }: { params: { id: string } }) {
  const admin = createAdminClient();

  const [{ data: overview }, { data: tenant }, { data: users }, { data: errors }, { data: crmFailures }, { data: events }, { data: grant }, { data: visits }, { data: settings }, { data: checklist }, { data: failures }] =
    await Promise.all([
      admin.rpc("platform_tenant_overview", { p_days: 30 }),
      admin
        .from("tenants")
        .select("id, name, slug, industry, plan, status, timezone, created_at, trial_ends_at, trial_started_at, paid_until, monthly_price, contact_email, notes, assistant_mode")
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
      // 0050: what is set up, read from their own data.
      admin.rpc("onboarding_checklist", { p_tenant_id: params.id }),
      // 0050: failures Elliot recorded for this agency this week.
      admin
        .from("audit_log")
        .select("id, event_type, details, created_at")
        .eq("tenant_id", params.id)
        .or(PROBLEM_FILTER)
        .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
        .order("created_at", { ascending: false })
        .limit(8),
    ]);

  if (!tenant) notFound();
  const row = ((overview ?? []) as TenantOverviewRow[]).find((r) => r.tenant_id === params.id);
  const state = row ? accountState(row) : accountState(tenant as any);
  type Step = { step: number; item: string; required: boolean; done: boolean; detail: string | null; where_to: string };
  const steps = (checklist ?? []) as Step[];
  const missing = steps.filter((s) => s.required && !s.done && s.step !== 13);
  const trialRunning = (tenant as any).plan === "trial" && !!(tenant as any).trial_started_at;
  const issues = row ? healthIssues(row, state) : [];
  const access = supportAccessState(grant, (tenant as any).assistant_mode, new Date(), settings?.support_permission_required ?? true);

  const usage = row
    ? [
        ["Conversations", n(row.conversations_count)],
        ["New leads", n(row.leads_count)],
        ["Hot leads now", n(row.hot_leads_count)],
        ["Viewings booked", n(row.appointments_count)],
        ["Open escalations", n(row.open_escalations)],
        ["Messages awaiting approval", n(row.pending_approvals)],
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
          <Panel
            title="Go-live checklist"
            action={
              steps.length ? (
                <span className={`text-[12.5px] ${missing.length ? "text-brass-dark" : "text-ink"}`}>
                  {missing.length ? `${missing.length} required step${missing.length === 1 ? "" : "s"} left` : "Ready to go live"}
                </span>
              ) : undefined
            }
            flush
          >
            {!steps.length ? (
              <p className="m-0 px-5 py-4 text-[13px] text-gray-500">Run migration 0050 in Supabase to see this agency&apos;s checklist.</p>
            ) : (
              <>
                <ol className="m-0 list-none p-0 text-[13px]">
                  {steps.map((s) => (
                    <li key={s.step} className="flex gap-3 border-t border-gray-100 px-5 py-2.5 first:border-t-0">
                      <span
                        aria-label={s.done ? "Done" : "Not done"}
                        className={`mt-0.5 inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                          s.done ? "bg-navy text-white" : s.required ? "border border-brass text-brass-dark" : "border border-gray-300 text-gray-400"
                        }`}
                      >
                        {s.done ? "✓" : ""}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block ${s.done ? "text-ink" : "text-ink"}`}>
                          {s.item}
                          {!s.required && <span className="ml-1.5 text-[12px] text-gray-400">if they use it</span>}
                        </span>
                        <span className="block break-words text-[12.5px] text-gray-500">
                          {s.detail}
                          {!s.done && <span className="text-gray-400"> · {s.where_to}</span>}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-5 py-3">
                  <p className="m-0 max-w-md text-[12.5px] text-gray-500">
                    Start the trial when Elliot goes live for them. When it ends, Elliot pauses: clients get a short holding reply and
                    their messages wait in the dashboard, until you change the plan.
                  </p>
                  <StartTrial tenantId={tenant.id} running={trialRunning} endsAt={trialRunning ? (tenant as any).trial_ends_at : null} />
                </div>
              </>
            )}
          </Panel>

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
            {issues.length === 0 && !errors?.length && !crmFailures?.length && !failures?.length ? (
              <p className="m-0 px-5 py-4 text-[13px] text-gray-500">Nothing wrong that Elliot can see.</p>
            ) : (
              <ul className="m-0 list-none p-0 text-[13px]">
                {issues.map((i) => (
                  <li key={i} className="border-t border-gray-100 px-5 py-3 first:border-t-0 text-alert">
                    {i}
                  </li>
                ))}
                {(failures ?? []).map((f: any) => (
                  <li key={f.id} className="border-t border-gray-100 px-5 py-3 first:border-t-0">
                    <span className="font-medium text-ink">{describeProblem(f.event_type).what}</span>{" "}
                    <span className="text-gray-500">{timeAgo(f.created_at)}</span>
                    {problemDetail(f.details) && <div className="break-words text-gray-600">{problemDetail(f.details)}</div>}
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

          {tenant.status === "cancelled" && tenant.assistant_mode === "agency" && (
            <Panel title="Delete this agency's data">
              <EraseAgency tenantId={tenant.id} slug={tenant.slug} name={tenant.name} />
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
