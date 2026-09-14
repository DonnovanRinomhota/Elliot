import { createClient } from "@/lib/supabase/server";
import { AlertTriangle, Mail, CalendarCheck, UserPlus } from "lucide-react";

type ActivityItem = {
  kind: "escalation" | "draft" | "appointment" | "lead";
  text: string;
  createdAt: string;
};

export default async function OverviewPage() {
  const supabase = createClient();

  // Real aggregated stats via the Postgres function (0021) -- not
  // client-computed, and specifically not a naive join for response time
  // (see the function's own comment for why that matters).
  const { data: statsRows, error: statsError } = await supabase.rpc(
    "get_dashboard_overview_stats",
    { p_days: 7 }
  );
  const stats = statsRows?.[0] ?? null;

  // Recent activity: four lightweight queries merged and sorted client-side
  // rather than one complex UNION -- each source has a different shape, and
  // this stays simple to read/maintain for four items merged into one feed.
  const [{ data: escalations }, { data: drafts }, { data: appointments }, { data: leads }] =
    await Promise.all([
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
    ]);

  const activity: ActivityItem[] = [
    ...(escalations ?? []).map((e: any) => ({
      kind: "escalation" as const,
      text: `Escalated: ${e.reason.replace(/_/g, " ")}`,
      createdAt: e.created_at,
    })),
    ...(drafts ?? []).map((d: any) => ({
      kind: "draft" as const,
      text:
        d.status === "auto_sent"
          ? `Auto-sent: ${d.subject}`
          : `Draft pending: ${d.subject}`,
      createdAt: d.created_at,
    })),
    ...(appointments ?? []).map((a: any) => ({
      kind: "appointment" as const,
      text: `Appointment booked: ${a.contact?.name || a.contact?.email || "unknown"}, ${new Date(a.starts_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`,
      createdAt: a.created_at,
    })),
    ...(leads ?? []).map((l: any) => ({
      kind: "lead" as const,
      text: `New lead (${l.status}): ${l.contact?.name || l.contact?.email || "unknown"}`,
      createdAt: l.created_at,
    })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);

  const icons = {
    escalation: <AlertTriangle size={15} color="#a11" aria-hidden="true" />,
    draft: <Mail size={15} color="#666" aria-hidden="true" />,
    appointment: <CalendarCheck size={15} color="#666" aria-hidden="true" />,
    lead: <UserPlus size={15} color="#666" aria-hidden="true" />,
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

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>Overview</h1>
          <p style={{ fontSize: 13, color: "#666", margin: "2px 0 0" }}>Here&apos;s what Elliot&apos;s been doing.</p>
        </div>
        <span style={{ fontSize: 13, color: "#666" }}>Last 7 days</span>
      </div>

      {statsError && (
        <p style={{ color: "crimson", fontSize: 13, marginBottom: 16 }}>
          Failed to load stats: {statsError.message}
        </p>
      )}

      {stats && (Number(stats.escalations_count) > 0 || Number(stats.auto_resolved_count) === 0) && (
        <div
          style={{
            background: "#fdf0d5",
            borderRadius: 10,
            padding: "10px 14px",
            marginBottom: 20,
            fontSize: 13,
            color: "#8a5a00",
          }}
        >
          {Number(stats.escalations_count) > 0
            ? `${stats.escalations_count} escalation${Number(stats.escalations_count) === 1 ? "" : "s"} in the last 7 days -- check the Escalations page.`
            : "No activity in the last 7 days yet."}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Conversations", value: stats?.conversations_count ?? "–" },
          { label: "New leads", value: stats?.new_leads_count ?? "–" },
          { label: "Appointments booked", value: stats?.appointments_booked_count ?? "–" },
          { label: "Auto-resolved", value: stats?.auto_resolved_count ?? "–" },
        ].map((card) => (
          <div key={card.label} style={{ background: "#f5f5f5", borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>{card.label}</div>
            <div style={{ fontSize: 22, fontWeight: 500 }}>{card.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>Recent activity</div>
          {activity.length === 0 && <p style={{ color: "#999", fontSize: 13 }}>Nothing yet.</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {activity.map((item, i) => (
              <div
                key={i}
                style={{ display: "flex", gap: 10, padding: "9px 10px", background: "#f5f5f5", borderRadius: 8, fontSize: 13, alignItems: "center" }}
              >
                {icons[item.kind]}
                <span style={{ flex: 1 }}>{item.text}</span>
                <span style={{ color: "#999", fontSize: 12 }}>{timeAgo(item.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>Response quality</div>
          <div style={{ background: "#f5f5f5", borderRadius: 8, padding: 14 }}>
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
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#666", marginBottom: 6 }}>
                <span>{row.label}</span>
                <span style={{ color: "#111", fontWeight: 500 }}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
