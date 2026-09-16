import { createClient } from "@/lib/supabase/server";
import {
  AlertTriangle,
  Mail,
  CalendarCheck,
  UserPlus,
  MessageCircle,
  Sparkles,
  ArrowRight,
  TrendingUp,
  DollarSign,
} from "lucide-react";

type ActivityItem = {
  kind: "escalation" | "draft" | "appointment" | "lead";
  text: string;
  createdAt: string;
  href: string;
};

// Same brand mapping lead-card.tsx already uses for status pills, kept in
// sync here so the "Leads by stage" chart uses identical colors to the
// badges you see on the Leads page itself.
const STAGE_ORDER = ["NEW", "QUALIFYING", "WARM", "HOT", "COLD", "CONVERTED", "LOST"];
const STAGE_COLORS: Record<string, string> = {
  NEW: "#3B82F6",
  QUALIFYING: "#60A5FA",
  WARM: "#E7A33E",
  HOT: "#FF6B5B",
  COLD: "#9CA3AF",
  CONVERTED: "#22E58F",
  LOST: "#D1D5DB",
};

// Cycles through this palette by channel name so whatever channels this
// tenant actually uses (email, chat_widget, sms, ...) each get a stable,
// distinct color -- nothing here is hardcoded to a specific channel list.
const CHANNEL_PALETTE = ["#4F46E5", "#22E58F", "#E7A33E", "#FF6B5B", "#0EA5E9", "#A855F7"];

export default async function DashboardPage() {
  const supabase = createClient();

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
      .select("id, starts_at, created_at, contact:contacts(name, email)")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("leads")
      .select("id, status, created_at, contact:contacts(name, email)")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("leads").select("status"),
    supabase
      .from("conversations")
      .select("channel, created_at")
      .gte("created_at", sevenDaysAgo.toISOString()),
  ]);

  const activity: ActivityItem[] = [
    ...(escalations ?? []).map((e: any) => ({
      kind: "escalation" as const,
      text: `Escalated: ${e.reason.replace(/_/g, " ")}`,
      createdAt: e.created_at,
      href: "/dashboard/escalations",
    })),
    ...(drafts ?? []).map((d: any) => ({
      kind: "draft" as const,
      text:
        d.status === "auto_sent"
          ? `Auto-sent: ${d.subject}`
          : `Draft pending: ${d.subject}`,
      createdAt: d.created_at,
      href: d.status === "auto_sent" ? "/dashboard/approvals?status=auto_sent" : "/dashboard/approvals?status=pending",
    })),
    ...(appointments ?? []).map((a: any) => ({
      kind: "appointment" as const,
      text: `Appointment booked: ${a.contact?.name || a.contact?.email || "unknown"}, ${new Date(a.starts_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`,
      createdAt: a.created_at,
      href: "/dashboard/appointments",
    })),
    ...(leads ?? []).map((l: any) => ({
      kind: "lead" as const,
      text: `New lead (${l.status}): ${l.contact?.name || l.contact?.email || "unknown"}`,
      createdAt: l.created_at,
      href: `/dashboard/leads?status=${l.status}`,
    })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);

  const activityStyles: Record<ActivityItem["kind"], { icon: JSX.Element; bg: string; color: string }> = {
    escalation: { icon: <AlertTriangle size={14} />, bg: "bg-coral-soft", color: "text-coral-dark" },
    draft: { icon: <Mail size={14} />, bg: "bg-indigo-50", color: "text-indigo-600" },
    appointment: { icon: <CalendarCheck size={14} />, bg: "bg-amber-soft", color: "text-amber-dark" },
    lead: { icon: <UserPlus size={14} />, bg: "bg-pulse-soft", color: "text-pulse-dark" },
  };

  function timeAgo(iso: string) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.round(hours / 24)}d`;
  }

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
    channelColor[c] = CHANNEL_PALETTE[i % CHANNEL_PALETTE.length];
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

  const CHART_HEIGHT = 128;

  // Every stat card links to the real, filtered page it's counting --
  // clicking "23" on Conversations takes you to the same 23 conversations,
  // not a dead number.
  const statCards = [
    {
      label: "Conversations",
      value: stats?.conversations_count ?? "–",
      icon: <MessageCircle size={18} />,
      bg: "bg-indigo-50",
      color: "text-indigo-600",
      href: "/dashboard/conversations?days=7",
    },
    {
      label: "New leads",
      value: stats?.new_leads_count ?? "–",
      icon: <UserPlus size={18} />,
      bg: "bg-pulse-soft",
      color: "text-pulse-dark",
      href: "/dashboard/leads?days=7",
    },
    {
      label: "Appointments booked",
      value: stats?.appointments_booked_count ?? "–",
      icon: <CalendarCheck size={18} />,
      bg: "bg-amber-soft",
      color: "text-amber-dark",
      href: "/dashboard/appointments?days=7",
    },
    {
      label: "Auto-resolved",
      value: stats?.auto_resolved_count ?? "–",
      icon: <Sparkles size={18} />,
      bg: "bg-violet-50",
      color: "text-violet-600",
      href: "/dashboard/approvals?status=auto_sent&days=7",
    },
  ];

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="m-0 text-3xl font-extrabold tracking-tight text-ink">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">Here&apos;s what Elliot&apos;s been doing.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">Last 7 days</span>
          <a
            href="/dashboard/leads"
            className="inline-flex items-center gap-1.5 rounded-md bg-ink px-4 py-2 text-xs font-semibold text-white no-underline transition hover:opacity-90"
          >
            View leads <ArrowRight size={14} />
          </a>
        </div>
      </div>

      {statsError && (
        <p className="mb-4 text-sm text-red-700">Failed to load stats: {statsError.message}</p>
      )}

      {stats && (Number(stats.escalations_count) > 0 || Number(stats.auto_resolved_count) === 0) && (
        <a
          href="/dashboard/escalations"
          className="mb-6 block rounded-xl bg-amber-soft px-4 py-2.5 text-sm font-medium text-amber-dark no-underline transition hover:opacity-90"
        >
          {Number(stats.escalations_count) > 0
            ? `${stats.escalations_count} escalation${Number(stats.escalations_count) === 1 ? "" : "s"} in the last 7 days -- check the Escalations page.`
            : "No activity in the last 7 days yet."}
        </a>
      )}

      {revenueError && (
        <p className="mb-4 text-sm text-red-700">Failed to load revenue estimate: {revenueError.message}</p>
      )}

      {revenue && revenue.avg_deal_value != null ? (
        <div className="mb-6 rounded-xl border border-gray-100 bg-ink p-5 text-white shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/60">
            <DollarSign size={14} /> Estimated impact -- last 30 days
          </div>
          <div className="flex items-end gap-8">
            <div>
              <div className="text-3xl font-extrabold tracking-tight">
                {Number(revenue.estimated_pipeline_value).toLocaleString()}
              </div>
              <div className="text-xs text-white/60">
                Estimated pipeline -- {revenue.qualified_leads_count} qualified lead
                {Number(revenue.qualified_leads_count) === 1 ? "" : "s"} × {Number(revenue.avg_deal_value).toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-3xl font-extrabold tracking-tight">
                {Number(revenue.estimated_closed_value).toLocaleString()}
              </div>
              <div className="text-xs text-white/60">
                Estimated closed value -- {revenue.converted_leads_count} converted lead
                {Number(revenue.converted_leads_count) === 1 ? "" : "s"}
              </div>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-white/40">
            Estimate based on your average deal value ({Number(revenue.avg_deal_value).toLocaleString()}, set in
            Settings) -- not a computed fact, an assumption you provided. No currency conversion is applied.
          </p>
        </div>
      ) : (
        <a
          href="/dashboard/settings"
          className="mb-6 block rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500 no-underline transition hover:border-gray-300 hover:bg-gray-100"
        >
          Set your average deal value in Settings to see an estimated pipeline/revenue figure here.
        </a>
      )}

      <div className="mb-6 grid grid-cols-4 gap-3">
        {statCards.map((card) => (
          <a
            key={card.label}
            href={card.href}
            className="group flex flex-col rounded-xl border border-gray-100 bg-white p-4 no-underline shadow-sm transition hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-md"
          >
            <div className="mb-4 flex items-center gap-3">
              <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${card.bg} ${card.color}`}>
                {card.icon}
              </span>
              <span className="text-sm font-semibold text-gray-600 group-hover:text-ink">{card.label}</span>
            </div>
            <div className="text-3xl font-extrabold tracking-tight text-ink">{card.value}</div>
          </a>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-bold text-ink">Activity this week</span>
            <a href="/dashboard/conversations?days=7" className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-gray-600">
              View all <TrendingUp size={14} />
            </a>
          </div>
          {channels.length === 0 ? (
            <p className="text-sm text-gray-400">No conversations in the last 7 days.</p>
          ) : (
            <>
              <div className="flex items-end justify-between gap-2" style={{ height: CHART_HEIGHT }}>
                {dayData.map((day) => (
                  <a
                    key={day.key}
                    href={`/dashboard/conversations?date=${day.key}`}
                    title={`${day.total} conversation${day.total === 1 ? "" : "s"} on ${day.label}`}
                    className="group flex flex-1 flex-col items-center justify-end gap-1 no-underline"
                    style={{ height: "100%" }}
                  >
                    <div
                      className="flex w-full max-w-[28px] flex-col-reverse overflow-hidden rounded-md transition group-hover:opacity-70 group-hover:ring-2 group-hover:ring-indigo-200"
                      style={{ height: CHART_HEIGHT - 20 }}
                    >
                      {channels.map((c) => {
                        const count = day.perChannel[c] ?? 0;
                        const pct = maxDayTotal > 0 ? (count / maxDayTotal) * 100 : 0;
                        if (pct === 0) return null;
                        return (
                          <div
                            key={c}
                            style={{ height: `${pct}%`, background: channelColor[c] }}
                          />
                        );
                      })}
                      {day.total === 0 && <div className="h-full w-full bg-gray-100" />}
                    </div>
                    <span className="text-[11px] font-medium text-gray-400 group-hover:text-ink">{day.label}</span>
                  </a>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                {channels.map((c) => (
                  <span key={c} className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: channelColor[c] }} />
                    {c.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-bold text-ink">Leads by stage</span>
            <a href="/dashboard/leads" className="text-xs font-medium text-gray-400 hover:text-gray-600">
              View all →
            </a>
          </div>
          {(leadStatuses ?? []).length === 0 ? (
            <p className="text-sm text-gray-400">No leads yet.</p>
          ) : (
            <div className="flex items-end justify-between gap-2" style={{ height: CHART_HEIGHT }}>
              {stageCounts.map(({ stage, count }) => {
                const pct = (count / maxStageCount) * 100;
                return (
                  <a
                    key={stage}
                    href={`/dashboard/leads?status=${stage}`}
                    title={`${count} ${stage.toLowerCase()} lead${count === 1 ? "" : "s"}`}
                    className="group flex flex-1 flex-col items-center justify-end gap-1 no-underline"
                    style={{ height: "100%" }}
                  >
                    <span className="text-[11px] font-semibold text-gray-600 group-hover:text-ink">{count}</span>
                    <div
                      className="w-full max-w-[26px] rounded-md transition group-hover:opacity-70 group-hover:ring-2 group-hover:ring-indigo-200"
                      style={{
                        height: `${Math.max(pct, count > 0 ? 4 : 0)}%`,
                        background: STAGE_COLORS[stage],
                        minHeight: count > 0 ? 3 : 0,
                      }}
                    />
                    <span className="text-[10px] font-medium text-gray-400 group-hover:text-ink">{stage.slice(0, 4)}</span>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[1.3fr_1fr] gap-4">
        <div>
          <div className="mb-2.5 text-sm font-bold text-ink">Recent activity</div>
          {activity.length === 0 && <p className="text-sm text-gray-400">Nothing yet.</p>}
          <div className="flex flex-col gap-1.5">
            {activity.map((item, i) => {
              const s = activityStyles[item.kind];
              return (
                <a
                  key={i}
                  href={item.href}
                  className="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2.5 no-underline transition hover:bg-gray-100"
                >
                  <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${s.bg} ${s.color}`}>
                    {s.icon}
                  </span>
                  <span className="flex-1 text-sm text-gray-700">{item.text}</span>
                  <span className="text-xs text-gray-400">{timeAgo(item.createdAt)}</span>
                </a>
              );
            })}
          </div>
        </div>
        <div>
          <div className="mb-2.5 text-sm font-bold text-ink">Response quality</div>
          <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            {[
              {
                label: "Avg response time",
                value: stats?.avg_response_seconds != null ? `${Math.round(stats.avg_response_seconds)}s` : "–",
              },
              { label: "Auto-resolved rate", value: stats?.auto_resolve_rate != null ? `${stats.auto_resolve_rate}%` : "–" },
              { label: "Escalation rate", value: stats?.escalation_rate != null ? `${stats.escalation_rate}%` : "–" },
              {
                label: "Avg resolution time",
                value:
                  stats?.avg_escalation_resolution_seconds != null
                    ? formatDuration(stats.avg_escalation_resolution_seconds)
                    : "–",
              },
            ].map((row) => (
              <div key={row.label} className="mb-2.5 flex items-center justify-between text-sm last:mb-0">
                <span className="text-gray-500">{row.label}</span>
                <span className="font-bold text-ink">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
