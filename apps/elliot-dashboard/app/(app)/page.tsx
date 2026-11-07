import { createClient } from "@/lib/supabase/server";
import { contactLabel } from "@/lib/contacts";
import { redirect } from "next/navigation";
import { getMembership } from "@/lib/tenant";
import { PageHeader, Panel, btn, humanize, timeAgo } from "../_ui/ui";

type ActivityItem = {
  kind: "escalation" | "draft" | "appointment" | "lead";
  text: string;
  createdAt: string;
  href: string;
};

const STAGE_ORDER = ["NEW", "QUALIFYING", "WARM", "HOT", "COLD", "CONVERTED", "LOST"];

// Channels are shades of the one ink colour (darkest = most common), so the
// chart stays in palette however many channels a tenant uses.
const CHANNEL_SHADES = ["#13223A", "#7D8BA3", "#C9D1DE", "#3B4D6B"];

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Real aggregated stats via the Postgres function (0021) -- not
  // client-computed, and specifically not a naive join for response time
  // (see the function's own comment for why that matters).
  const { data: statsRows, error: statsError } = await supabase.rpc(
    "get_dashboard_overview_stats",
    { p_days: 7 }
  );
  const stats = statsRows?.[0] ?? null;

  // Separate call, separate (longer) window -- a revenue estimate over just
  // 7 days reads as tiny/unconvincing next to "pipeline," and this is
  // meant to answer "what has Elliot generated" as an ongoing headline
  // figure, not a weekly snapshot like the stat cards above.
  const { data: revenueRows, error: revenueError } = await supabase.rpc(
    "get_revenue_dashboard_stats",
    { p_days: 30 }
  );
  const revenue = revenueRows?.[0] ?? null;

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6);
  sevenDaysAgo.setUTCHours(0, 0, 0, 0);

  // Recent activity: four lightweight queries merged and sorted client-side
  // rather than one complex UNION -- each source has a different shape, and
  // this stays simple to read/maintain for four items merged into one feed.
  // Plus two new queries for the charts below: every lead's status (for the
  // "Leads by stage" bar chart) and the last 7 days of conversations (for
  // the "Activity this week" chart), both real tenant data via RLS.
  const [
    { data: escalations },
    { data: drafts },
    { data: appointments },
    { data: leads },
    { data: leadStatuses },
    { data: recentConversations },
    { count: pendingApprovals },
    { data: hotLeads },
    { data: upcoming },
    { count: openEscalations },
    { count: myChats },
    { data: tenantRow },
    me,
  ] = await Promise.all([
    supabase
      .from("escalations")
      .select("id, reason, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("email_drafts")
      .select("id, subject, status, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("appointments")
      .select("id, starts_at, created_at, contact:contacts(name, email, phone)")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("leads")
      .select("id, status, created_at, contact:contacts(name, email, phone)")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("leads").select("status"),
    supabase
      .from("conversations")
      .select("channel, created_at")
      .gte("created_at", sevenDaysAgo.toISOString()),
    supabase.from("email_drafts").select("id", { count: "exact", head: true }).eq("status", "pending"),
    // "Needs you now": hot leads, today's viewings, open handovers, chats you're handling.
    supabase
      .from("leads")
      .select("id, updated_at, assigned_to, owner:tenant_users(full_name, email), contact:contacts(name, email, phone)")
      .eq("status", "HOT")
      .order("updated_at", { ascending: false })
      .limit(5),
    supabase
      .from("appointments")
      .select("id, starts_at, notes, contact:contacts(name, phone), listing:listings(title, address, district), agent:tenant_users(full_name, email)")
      .eq("status", "confirmed")
      .gte("starts_at", new Date(Date.now() - 14 * 3600 * 1000).toISOString())
      .lte("starts_at", new Date(Date.now() + 26 * 3600 * 1000).toISOString())
      .order("starts_at"),
    supabase.from("escalations").select("id", { count: "exact", head: true }).neq("status", "resolved"),
    supabase.from("conversations").select("id", { count: "exact", head: true }).not("assigned_human", "is", null),
    supabase.from("tenants").select("timezone").maybeSingle(),
    getMembership(supabase, user.id),
  ]);

  // Today's viewings in the agency's own time zone.
  const tz = tenantRow?.timezone || "Europe/Warsaw";
  const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: tz });
  const todayKey = dayKey(new Date());
  const todaysViewings = (upcoming ?? []).filter((a: any) => dayKey(new Date(a.starts_at)) === todayKey);

  const activity: ActivityItem[] = [
    ...(escalations ?? []).map((e: any) => ({
      kind: "escalation" as const,
      text: humanize(e.reason),
      createdAt: e.created_at,
      href: "/dashboard/escalations",
    })),
    ...(drafts ?? []).map((d: any) => ({
      kind: "draft" as const,
      text: d.status === "auto_sent" ? `Sent automatically: ${d.subject}` : `Waiting for approval: ${d.subject}`,
      createdAt: d.created_at,
      href: d.status === "auto_sent" ? "/dashboard/approvals?status=auto_sent" : "/dashboard/approvals?status=pending",
    })),
    ...(appointments ?? []).map((a: any) => ({
      kind: "appointment" as const,
      text: `${contactLabel(a.contact)}, ${new Date(a.starts_at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`,
      createdAt: a.created_at,
      href: `/dashboard/appointments/${a.id}`,
    })),
    ...(leads ?? []).map((l: any) => ({
      kind: "lead" as const,
      text: `${contactLabel(l.contact)}, ${humanize(l.status).toLowerCase()}`,
      createdAt: l.created_at,
      href: `/dashboard/leads?status=${l.status}`,
    })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);

  // Takes seconds (this stat comes from a SQL avg(extract(epoch from ...))),
  // not the two-ISO-string shape used by the escalation card's own
  // formatDuration -- same name, different input, kept local to each file
  // rather than sharing a util for two call sites this small.
  function formatDuration(totalSeconds: number) {
    const mins = Math.round(totalSeconds / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hours < 24) return `${hours}h ${remMins}m`;
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days}d ${remHours}h`;
  }

  // --- Leads by stage chart data ---
  const stageCounts = STAGE_ORDER.map((stage) => ({
    stage,
    count: (leadStatuses ?? []).filter((l: any) => l.status === stage).length,
  }));
  const maxStageCount = Math.max(1, ...stageCounts.map((s) => s.count));

  // --- Activity this week chart data ---
  const dayKeys: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    dayKeys.push(d.toISOString().slice(0, 10));
  }
  const channels = Array.from(new Set((recentConversations ?? []).map((r: any) => r.channel))).sort();
  const channelColor: Record<string, string> = {};
  channels.forEach((c, i) => {
    channelColor[c] = CHANNEL_SHADES[i % CHANNEL_SHADES.length];
  });
  const dayData = dayKeys.map((key) => {
    const rowsForDay = (recentConversations ?? []).filter((r: any) => r.created_at.slice(0, 10) === key);
    const perChannel: Record<string, number> = {};
    channels.forEach((c) => {
      perChannel[c] = rowsForDay.filter((r: any) => r.channel === c).length;
    });
    return {
      key,
      label: new Date(`${key}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
      perChannel,
      total: rowsForDay.length,
    };
  });
  const maxDayTotal = Math.max(1, ...dayData.map((d) => d.total));

  const CHART_HEIGHT = 140;
  const KIND_LABEL: Record<ActivityItem["kind"], string> = {
    escalation: "Escalation",
    draft: "Email",
    appointment: "Viewing",
    lead: "Lead",
  };

  // Every figure links to the filtered page it's counting.
  const kpis = [
    { label: "Conversations", value: stats?.conversations_count, href: "/dashboard/conversations?days=7" },
    { label: "New leads", value: stats?.new_leads_count, href: "/dashboard/leads?days=7" },
    { label: "Viewings booked", value: stats?.appointments_booked_count, href: "/dashboard/appointments?days=7" },
    { label: "Answered without help", value: stats?.auto_resolved_count, href: "/dashboard/approvals?status=auto_sent&days=7" },
  ];

  const approvalCount = Number(pendingApprovals ?? 0);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  return (
    <div>
      <PageHeader
        title="Overview"
        description={null}
        actions={
          <a href="/dashboard/leads" className={btn.secondary}>
            View leads
          </a>
        }
      />

      {statsError && <p className="mb-4 text-[13px] text-alert">Couldn&apos;t load the figures: {statsError.message}</p>}

      <p className="-mt-3 mb-6 max-w-3xl text-[15px] leading-relaxed text-ink">
        {stats ? (
          <>
            In the last 7 days Elliot had <strong className="font-semibold">{plural(Number(stats.conversations_count), "conversation")}</strong>,
            captured <strong className="font-semibold">{plural(Number(stats.new_leads_count), "new lead")}</strong> and booked{" "}
            <strong className="font-semibold">{plural(Number(stats.appointments_booked_count), "viewing")}</strong>
            {Number(stats.conversations_count) > 0 && stats.auto_resolve_rate != null && (
              <>, answering {stats.auto_resolve_rate}% of chats without help</>
            )}
            .
          </>
        ) : (
          "Your figures will appear here once Elliot starts talking to visitors."
        )}
      </p>

      <section aria-label="Needs you now" className="mb-6 grid gap-6 lg:grid-cols-3">
        <Panel
          title={`Hot leads to call${(hotLeads ?? []).length ? ` (${(hotLeads ?? []).length}${(hotLeads ?? []).length === 5 ? "+" : ""})` : ""}`}
          action={
            <a href="/dashboard/leads?status=HOT" className="text-[13px] text-gray-500 hover:text-ink">
              All hot leads
            </a>
          }
          flush
        >
          {(hotLeads ?? []).length === 0 ? (
            <p className="m-0 px-5 py-4 text-[13px] text-gray-500">No hot leads right now.</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {(hotLeads ?? []).map((l: any) => (
                <li key={l.id} className="border-t border-gray-100 px-5 py-3 first:border-t-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[13.5px] font-medium text-ink">{contactLabel(l.contact)}</span>
                    <span className="whitespace-nowrap text-[12px] text-gray-400">{timeAgo(l.updated_at)}</span>
                  </div>
                  <div className="text-[12.5px] text-gray-600">
                    {l.contact?.phone ? (
                      <a href={`tel:${l.contact.phone.replace(/\s/g, "")}`} className="text-ink">
                        {l.contact.phone}
                      </a>
                    ) : (
                      l.contact?.email || "No phone given"
                    )}
                    {l.assigned_to && (
                      <span className="text-gray-400">
                        {" "}
                        · {me && l.assigned_to === me.id ? "yours" : l.owner?.full_name || l.owner?.email?.split("@")[0]}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title={`Viewings today (${todaysViewings.length})`}
          action={
            <a href="/dashboard/calendar" className="text-[13px] text-gray-500 hover:text-ink">
              Calendar
            </a>
          }
          flush
        >
          {todaysViewings.length === 0 ? (
            <p className="m-0 px-5 py-4 text-[13px] text-gray-500">Nothing booked for today.</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {todaysViewings.map((a: any) => (
                <li key={a.id} className="border-t border-gray-100 first:border-t-0">
                  <a href={`/dashboard/appointments/${a.id}`} className="grid grid-cols-[52px_1fr] gap-3 px-5 py-3 no-underline hover:bg-gray-50">
                    <span className="tabular text-[13.5px] font-medium text-ink">
                      {new Date(a.starts_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz })}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] text-ink">{contactLabel(a.contact)}</span>
                      <span className="block truncate text-[12.5px] text-gray-500">
                        {[
                          a.listing ? [a.listing.title, a.listing.address || a.listing.district].filter(Boolean).join(", ") : a.notes,
                          a.agent ? a.agent.full_name || a.agent.email : "no agent yet",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Waiting on you" flush>
          <ul className="m-0 list-none p-0">
            {[
              { label: "Chats that need a person", count: Number(openEscalations ?? 0), href: "/dashboard/inbox", tone: "alert" },
              { label: "Emails waiting for approval", count: approvalCount, href: "/dashboard/approvals", tone: "brass" },
              { label: "Chats a person is handling", count: Number(myChats ?? 0), href: "/dashboard/inbox", tone: "ink" },
            ].map((row) => (
              <li key={row.label} className="border-t border-gray-100 first:border-t-0">
                <a href={row.href} className="flex items-center justify-between gap-3 px-5 py-3 no-underline hover:bg-gray-50">
                  <span className="text-[13.5px] text-gray-700">{row.label}</span>
                  <span
                    className={`tabular text-[18px] font-semibold ${
                      row.count === 0 ? "text-gray-300" : row.tone === "alert" ? "text-alert" : row.tone === "brass" ? "text-brass-dark" : "text-ink"
                    }`}
                  >
                    {row.count}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      </section>

      <section aria-label="Last 7 days" className="mb-6 grid grid-cols-2 overflow-hidden rounded-lg border border-gray-200 bg-white lg:grid-cols-4">
        {kpis.map((k, i) => (
          <a
            key={k.label}
            href={k.href}
            className={`block px-5 py-5 no-underline hover:bg-gray-50 ${i > 0 ? "lg:border-l" : ""} ${i % 2 === 1 ? "border-l" : ""} ${i > 1 ? "border-t lg:border-t-0" : ""} border-gray-200`}
          >
            <div className="tabular text-[30px] font-semibold leading-none tracking-[-0.02em] text-ink">{k.value ?? "–"}</div>
            <div className="mt-2 text-[13px] text-gray-500">{k.label}</div>
          </a>
        ))}
      </section>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title="Conversations by day"
          action={
            <a href="/dashboard/conversations?days=7" className="text-[13px] text-gray-500 hover:text-ink">
              View all
            </a>
          }
        >
          {channels.length === 0 ? (
            <p className="m-0 text-[13px] text-gray-500">No conversations in the last 7 days.</p>
          ) : (
            <>
              <div className="flex items-end justify-between gap-3" style={{ height: CHART_HEIGHT }}>
                {dayData.map((day) => (
                  <a
                    key={day.key}
                    href={`/dashboard/conversations?date=${day.key}`}
                    title={`${day.total} conversation${day.total === 1 ? "" : "s"} on ${day.label}`}
                    className="group flex h-full flex-1 flex-col items-center justify-end gap-2 no-underline"
                  >
                    <span className="tabular text-[12px] text-gray-500">{day.total || ""}</span>
                    <div
                      className="flex w-full max-w-[36px] flex-col-reverse overflow-hidden rounded-[3px] group-hover:opacity-80"
                      style={{ height: `${(day.total / maxDayTotal) * (CHART_HEIGHT - 44)}px`, minHeight: 2, background: day.total ? undefined : "#E5E7EB" }}
                    >
                      {channels.map((c) => {
                        const count = day.perChannel[c] ?? 0;
                        if (!count) return null;
                        return <div key={c} style={{ height: `${(count / day.total) * 100}%`, background: channelColor[c] }} />;
                      })}
                    </div>
                    <span className="text-[12px] text-gray-500 group-hover:text-ink">{day.label}</span>
                  </a>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-4 border-t border-gray-100 pt-3">
                {channels.map((c) => (
                  <span key={c} className="flex items-center gap-1.5 text-[12.5px] text-gray-600">
                    <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: channelColor[c] }} />
                    {humanize(c)}
                  </span>
                ))}
              </div>
            </>
          )}
        </Panel>

        <Panel title="Estimated value, last 30 days">
          {revenueError && <p className="m-0 text-[13px] text-alert">Couldn&apos;t load: {revenueError.message}</p>}
          {revenue && revenue.avg_deal_value != null ? (
            <>
              <dl className="m-0 grid gap-4">
                <div>
                  <dt className="text-[13px] text-gray-500">Pipeline</dt>
                  <dd className="tabular m-0 text-[24px] font-semibold tracking-[-0.01em] text-ink">
                    {Number(revenue.estimated_pipeline_value).toLocaleString("en-GB")}
                  </dd>
                  <dd className="m-0 text-[12.5px] text-gray-500">
                    {revenue.qualified_leads_count} qualified lead{Number(revenue.qualified_leads_count) === 1 ? "" : "s"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[13px] text-gray-500">Closed</dt>
                  <dd className="tabular m-0 text-[24px] font-semibold tracking-[-0.01em] text-ink">
                    {Number(revenue.estimated_closed_value).toLocaleString("en-GB")}
                  </dd>
                  <dd className="m-0 text-[12.5px] text-gray-500">
                    {revenue.converted_leads_count} converted lead{Number(revenue.converted_leads_count) === 1 ? "" : "s"}
                  </dd>
                </div>
              </dl>
              <p className="mb-0 mt-4 border-t border-gray-100 pt-3 text-[12px] leading-relaxed text-gray-400">
                Based on your average deal value of {Number(revenue.avg_deal_value).toLocaleString("en-GB")} from
                Settings. An estimate, not a booked figure.
              </p>
            </>
          ) : (
            !revenueError && (
              <p className="m-0 text-[13px] text-gray-500">
                Add your average deal value in{" "}
                <a href="/dashboard/settings" className="text-ink underline">
                  Settings
                </a>{" "}
                to see an estimate of your pipeline here.
              </p>
            )
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Recent activity" flush>
          {activity.length === 0 ? (
            <p className="m-0 px-5 py-4 text-[13px] text-gray-500">Nothing has happened yet.</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {activity.map((item, i) => (
                <li key={i} className="border-t border-gray-100 first:border-t-0">
                  <a href={item.href} className="grid grid-cols-[96px_1fr_auto] items-baseline gap-3 px-5 py-3 no-underline hover:bg-gray-50">
                    <span className="text-[12.5px] text-gray-500">{KIND_LABEL[item.kind]}</span>
                    <span className="truncate text-[13.5px] text-ink">{item.text}</span>
                    <span className="whitespace-nowrap text-[12.5px] text-gray-400">{timeAgo(item.createdAt)}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="grid content-start gap-6">
          <Panel
            title="Leads by stage"
            action={
              <a href="/dashboard/leads" className="text-[13px] text-gray-500 hover:text-ink">
                View all
              </a>
            }
          >
            {(leadStatuses ?? []).length === 0 ? (
              <p className="m-0 text-[13px] text-gray-500">No leads yet.</p>
            ) : (
              <ul className="m-0 grid list-none gap-2.5 p-0">
                {stageCounts.map(({ stage, count }) => (
                  <li key={stage}>
                    <a href={`/dashboard/leads?status=${stage}`} className="group grid grid-cols-[88px_1fr_24px] items-center gap-3 no-underline">
                      <span className="text-[13px] text-gray-600 group-hover:text-ink">{humanize(stage)}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-gray-100">
                        <span className="block h-full rounded-full bg-ink" style={{ width: `${(count / maxStageCount) * 100}%` }} />
                      </span>
                      <span className="tabular text-right text-[13px] text-ink">{count}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Response quality">
            <dl className="m-0 grid gap-2.5">
              {[
                {
                  label: "Average reply time",
                  value: stats?.avg_response_seconds != null ? `${Math.round(stats.avg_response_seconds)} s` : "–",
                },
                { label: "Answered without help", value: stats?.auto_resolve_rate != null ? `${stats.auto_resolve_rate}%` : "–" },
                { label: "Handed to a person", value: stats?.escalation_rate != null ? `${stats.escalation_rate}%` : "–" },
                {
                  label: "Time to resolve a handover",
                  value: stats?.avg_escalation_resolution_seconds != null ? formatDuration(stats.avg_escalation_resolution_seconds) : "–",
                },
              ].map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-[13px] text-gray-500">{row.label}</dt>
                  <dd className="tabular m-0 text-[13.5px] font-medium text-ink">{row.value}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}
