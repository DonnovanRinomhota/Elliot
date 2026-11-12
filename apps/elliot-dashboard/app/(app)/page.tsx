import { redirect } from "next/navigation";
import { ArrowRight, CalendarCheck, CalendarDays, ChevronRight, CircleCheck, Flame, Inbox, Mail, MapPin, MessageCircle, UserPlus, UserX, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { contactLabel } from "@/lib/contacts";
import { getMembership } from "@/lib/tenant";
import { DEFAULT_TZ, addDays, dayKey, personName, timeOf } from "@/lib/appointments";
import { Sparkline } from "../_ui/charts";
import { BrandTile } from "../_ui/brands";
import { btn, humanize, timeAgo } from "../_ui/ui";
import { AskElliotButton } from "./dashboard/ask-elliot";
import { ElliotMark } from "../_ui/elliot-logo";

const STAGE_ORDER = ["NEW", "QUALIFYING", "WARM", "HOT", "COLD", "CONVERTED", "LOST"];

type ActivityItem = { kind: "Handover" | "Email" | "Viewing" | "Lead"; text: string; createdAt: string; href: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function change(now: number, before: number): { text: string; up: boolean } | null {
  if (!before && !now) return null;
  if (!before) return { text: "new", up: true };
  const pct = Math.round(((now - before) / before) * 100);
  return { text: `${pct > 0 ? "+" : ""}${pct}%`, up: pct >= 0 };
}

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const now = new Date();
  const ago = (days: number) => new Date(now.getTime() - days * 86400_000).toISOString();

  const [
    { data: statsRows, error: statsError },
    { data: revenueRows },
    { data: tenantRow },
    me,
    { data: escalations },
    { data: drafts },
    { data: appointments },
    { data: leads },
    { data: leadStatuses },
    { data: convRows },
    { data: leadRows },
    { data: bookedRows },
    { count: pendingApprovals },
    { data: hotLeads, count: hotCount },
    { data: upcoming },
    { data: openEsc, count: openEscalations },
    { count: handledChats },
    { count: unassignedViewings },
  ] = await Promise.all([
    supabase.rpc("get_dashboard_overview_stats", { p_days: 7 }),
    supabase.rpc("get_revenue_dashboard_stats", { p_days: 30 }),
    supabase.from("tenants").select("timezone").maybeSingle(),
    getMembership(supabase, user.id),
    supabase.from("escalations").select("id, reason, created_at").order("created_at", { ascending: false }).limit(5),
    supabase.from("email_drafts").select("id, subject, status, created_at").order("created_at", { ascending: false }).limit(5),
    supabase.from("appointments").select("id, starts_at, created_at, contact:contacts(name, email, phone)").order("created_at", { ascending: false }).limit(5),
    supabase.from("leads").select("id, status, created_at, contact:contacts(name, email, phone)").order("created_at", { ascending: false }).limit(5),
    supabase.from("leads").select("status"),
    // For the figures: two weeks of chats (with their channel), leads and bookings.
    supabase.from("conversations").select("created_at, channel").gte("created_at", ago(14)),
    supabase.from("leads").select("created_at").gte("created_at", ago(14)),
    supabase.from("appointments").select("created_at").gte("created_at", ago(14)),
    supabase.from("email_drafts").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase
      .from("leads")
      .select("id, updated_at, assigned_to, owner:tenant_users(full_name, email), contact:contacts(name, email, phone)", { count: "exact" })
      .eq("status", "HOT")
      .order("updated_at", { ascending: false })
      .limit(1),
    supabase
      .from("appointments")
      .select("id, starts_at, ends_at, notes, contact:contacts(name, phone), listing:listings(title, address, district, photos, image_url), agent:tenant_users(full_name, email)")
      .in("status", ["confirmed", "rescheduled", "completed"])
      .gte("starts_at", ago(1.1))
      .lte("starts_at", new Date(now.getTime() + 1.1 * 86400_000).toISOString())
      .order("starts_at"),
    supabase
      .from("escalations")
      .select("id, reason, priority, context_summary, created_at, conversation_id", { count: "exact" })
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(1),
    supabase.from("conversations").select("id", { count: "exact", head: true }).not("assigned_human", "is", null),
    supabase.from("appointments").select("id", { count: "exact", head: true }).is("agent_id", null).neq("status", "cancelled").gte("starts_at", now.toISOString()),
  ]);

  const stats = statsRows?.[0] ?? null;
  const revenue = revenueRows?.[0] ?? null;
  const tz = tenantRow?.timezone || DEFAULT_TZ;
  const today = dayKey(now, tz);

  const todays = ((upcoming ?? []) as any[]).filter((a) => dayKey(a.starts_at, tz) === today);
  const nextViewing = todays.find((a) => new Date(a.ends_at) > now);
  const waitingChats = Number(openEscalations ?? 0);
  const approvals = Number(pendingApprovals ?? 0);
  const hot = Number(hotCount ?? 0);
  const unassigned = Number(unassignedViewings ?? 0);
  const summaryBits = [
    waitingChats ? `${plural(waitingChats, "chat")} need${waitingChats === 1 ? "s" : ""} a person` : null,
    approvals ? `${plural(approvals, "email")} waiting for approval` : null,
    hot ? `${plural(hot, "hot lead")} to call` : null,
  ].filter(Boolean) as string[];
  const summary = summaryBits.length
    ? `${summaryBits.join(", ").replace(/, ([^,]*)$/, " and $1")}. ${todays.length ? `${plural(todays.length, "viewing")} today.` : ""}`
    : `Nothing is waiting for you.${todays.length ? ` ${plural(todays.length, "viewing")} today.` : ""}`;

  // ── Series (days in the agency's time zone) ──
  const daysBack = (n: number) => Array.from({ length: n }, (_, i) => addDays(today, i - (n - 1)));
  const perDay = (rows: { created_at: string }[] | null, days: string[]) => {
    const c = new Map(days.map((d) => [d, 0]));
    for (const r of rows ?? []) {
      const k = dayKey(r.created_at, tz);
      if (c.has(k)) c.set(k, (c.get(k) ?? 0) + 1);
    }
    return days.map((d) => c.get(d) ?? 0);
  };
  const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
  const inRange = (rows: { created_at: string }[] | null, from: string, to: string) => (rows ?? []).filter((r) => { const k = dayKey(r.created_at, tz); return k >= from && k < to; }).length;

  const week = daysBack(7);
  const convWeek = perDay(convRows as any, week);
  const convNow = sum(convWeek);
  const convBefore = inRange(convRows as any, addDays(today, -13), addDays(today, -6));
  const convChange = change(convNow, convBefore);
  const handovers = Number(stats?.escalations_count ?? 0);

  const fortnight = daysBack(14);
  const leadSeries = perDay(leadRows as any, fortnight);
  const bookedSeries = perDay(bookedRows as any, fortnight);

  const handledByElliot = Math.max(0, convNow - handovers);
  const elliotRate = convNow ? Math.round((handledByElliot / convNow) * 100) : null;

  // ── Leads by stage ──
  const stageCounts = STAGE_ORDER.map((stage) => ({ stage, count: (leadStatuses ?? []).filter((l: any) => l.status === stage).length }));
  const maxStage = Math.max(1, ...stageCounts.map((s) => s.count));

  // ── Recent activity ──
  const activity: ActivityItem[] = [
    ...(escalations ?? []).map((e: any) => ({ kind: "Handover" as const, text: humanize(e.reason), createdAt: e.created_at, href: "/dashboard/escalations" })),
    ...(drafts ?? []).map((d: any) => ({
      kind: "Email" as const,
      text: d.status === "auto_sent" ? `Sent automatically: ${d.subject}` : `Waiting for approval: ${d.subject}`,
      createdAt: d.created_at,
      href: d.status === "auto_sent" ? "/dashboard/approvals?status=auto_sent" : "/dashboard/approvals?status=pending",
    })),
    ...(appointments ?? []).map((a: any) => ({
      kind: "Viewing" as const,
      text: `${contactLabel(a.contact)}, ${new Date(a.starts_at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz })}`,
      createdAt: a.created_at,
      href: `/dashboard/appointments/${a.id}`,
    })),
    ...(leads ?? []).map((l: any) => ({ kind: "Lead" as const, text: `${contactLabel(l.contact)}, ${humanize(l.status).toLowerCase()}`, createdAt: l.created_at, href: `/dashboard/leads?status=${l.status}` })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6);

  // ── The one thing to do first ──
  const topEsc = (openEsc ?? [])[0] as any;
  const topHot = (hotLeads ?? [])[0] as any;
  const focus = topEsc
    ? {
        kicker: "Waiting for a person",
        title: humanize(topEsc.reason),
        body: topEsc.context_summary,
        meta: timeAgo(topEsc.created_at),
        href: topEsc.conversation_id ? `/dashboard/conversations/${topEsc.conversation_id}` : "/dashboard/escalations",
        tone: "alert" as const,
      }
    : topHot
      ? {
          kicker: "Hot lead to call",
          title: contactLabel(topHot.contact),
          body: [topHot.contact?.phone || topHot.contact?.email, topHot.owner ? personName(topHot.owner) : "No owner yet"].filter(Boolean).join(" · "),
          meta: timeAgo(topHot.updated_at),
          href: "/dashboard/leads?status=HOT",
          tone: "alert" as const,
        }
      : null;

  const queue = [
    { label: "Chats waiting for a person", count: waitingChats, href: "/dashboard/escalations?status=open", icon: Inbox, tone: "alert" },
    { label: "Hot leads to call", count: hot, href: "/dashboard/leads?status=HOT", icon: Flame, tone: "alert" },
    { label: "Emails to approve", count: approvals, href: "/dashboard/approvals", icon: Mail, tone: "brass" },
    { label: "Viewings without an agent", count: unassigned, href: "/dashboard/appointments?agent=none", icon: UserX, tone: "brass" },
    { label: "Chats a person is handling", count: Number(handledChats ?? 0), href: "/dashboard/inbox", icon: MessageCircle, tone: "ink" },
  ];
  const queueTotal = queue.slice(0, 4).reduce((s, q) => s + q.count, 0);

  // ── The greeting ──
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now));
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = (me?.full_name || "").trim().split(/\s+/)[0] || "";
  const chatsToday = convWeek[convWeek.length - 1] ?? 0;
  const headline = chatsToday
    ? `Elliot answered ${plural(chatsToday, "chat")} today.`
    : convNow
      ? `Elliot answered ${plural(convNow, "chat")} this week.`
      : "Elliot is ready for your clients.";
  const dateLine = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(now);

  // ── Figures: this week against the week before ──
  const leadsWeek = sum(leadSeries.slice(7));
  const leadsWeekChange = change(leadsWeek, sum(leadSeries.slice(0, 7)));
  const bookedWeek = sum(bookedSeries.slice(7));
  const bookedWeekChange = change(bookedWeek, sum(bookedSeries.slice(0, 7)));

  // ── Where this week's chats came from ──
  const CHANNELS = [
    { key: "chat_widget", label: "Website chat" },
    { key: "whatsapp", label: "WhatsApp" },
    { key: "email", label: "Email" },
    { key: "sms", label: "SMS" },
  ] as const;
  const weekStart = week[0];
  const channelCounts = CHANNELS.map((c) => ({
    ...c,
    count: ((convRows ?? []) as { created_at: string; channel: string | null }[]).filter((r) => r.channel === c.key && dayKey(r.created_at, tz) >= weekStart).length,
  })).filter((c) => c.count > 0);
  const maxChannel = Math.max(1, ...channelCounts.map((c) => c.count));

  const STAGE_COLOR: Record<string, string> = {
    NEW: "#9DB7E0",
    QUALIFYING: "#6F95D1",
    WARM: "#D9A56C",
    HOT: "#F07167",
    COLD: "#B8C3D4",
    CONVERTED: "#3FBF73",
    LOST: "#D2DBE8",
  };
  const COUNT_PILL: Record<string, string> = {
    alert: "bg-alert-soft text-alert-dark",
    brass: "bg-gold/20 text-brass-dark",
    ink: "bg-ink text-white",
  };
  const ACTIVITY_ICON = { Handover: Inbox, Email: Mail, Viewing: CalendarCheck, Lead: UserPlus } as const;
  const initialsOf = (p: { full_name: string | null; email: string } | null | undefined) =>
    personName(p)
      .split(/[\s.@_-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("");

  const ChangeNote = ({ c, label }: { c: ReturnType<typeof change>; label: string }) =>
    c ? (
      <span className={`text-[12.5px] font-medium ${c.up ? "text-[#237a49]" : "text-gray-500"}`}>
        {c.up ? "↑" : "↓"} {c.text} <span className="font-normal text-gray-500">{label}</span>
      </span>
    ) : (
      <span className="text-[12.5px] text-gray-500">{label}</span>
    );

  const figures = [
    {
      label: "Conversations",
      value: String(convNow),
      note: <ChangeNote c={convChange} label="vs last week" />,
      icon: MessageCircle,
      href: "/dashboard/conversations?days=7",
      chart: <Sparkline id="spark-chats" values={convWeek} label={`Chats per day this week: ${convWeek.join(", ")}`} />,
    },
    {
      label: "New leads",
      value: String(leadsWeek),
      note: <ChangeNote c={leadsWeekChange} label="vs last week" />,
      icon: Users,
      href: "/dashboard/leads?days=7",
      chart: <Sparkline id="spark-leads" values={leadSeries} label={`New leads per day, last 14 days: ${leadSeries.join(", ")}`} />,
    },
    {
      label: "Viewings booked",
      value: String(bookedWeek),
      note: <ChangeNote c={bookedWeekChange} label="vs last week" />,
      icon: CalendarCheck,
      href: "/dashboard/appointments",
      chart: <Sparkline id="spark-booked" values={bookedSeries} label={`Viewings booked per day, last 14 days: ${bookedSeries.join(", ")}`} />,
    },
    {
      label: "Handled by Elliot",
      value: elliotRate == null ? "–" : `${elliotRate}%`,
      note: <span className="text-[12.5px] text-gray-500">{handovers ? `${plural(handovers, "chat")} handed to a person` : "No person needed"}</span>,
      icon: CircleCheck,
      href: "/dashboard/escalations",
      chart: (
        <span className="block h-2 w-[112px] flex-shrink-0 overflow-hidden rounded-full bg-gray-100" role="img" aria-label={`${elliotRate ?? 0}% handled by Elliot`}>
          <span className="gold-fill block h-full rounded-full" style={{ width: `${elliotRate ?? 0}%` }} />
        </span>
      ),
    },
  ];

  const panel = "card p-5 md:p-6";
  const panelTitle = "m-0 text-[17px] font-semibold tracking-[-0.01em] text-ink";
  const panelLink = "inline-flex items-center gap-1 text-[12.5px] font-semibold text-brass-dark no-underline hover:text-ink";
  const row = "flex items-center gap-3 rounded-2xl border border-[rgba(15,31,56,0.06)] bg-[#f3f6fb] px-3 py-3 no-underline transition-colors hover:border-gold/40 hover:bg-white";

  return (
    <div>
      {/* ── The sky band: greeting and the main actions ── */}
      <section className="sky relative -mx-4 -mt-6 overflow-hidden px-4 pb-24 pt-8 text-white md:-mx-6 md:-mt-7 md:px-8 md:pb-28 md:pt-10 lg:-mx-7 lg:px-9">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-b from-transparent to-[#eef2f8]" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <p className="m-0 flex items-center gap-3 text-[11.5px] font-medium uppercase tracking-[0.24em] text-white/85">
              <span aria-hidden="true" className="h-px w-9 bg-white/70" />
              Overview · {dateLine}
            </p>
            <h1 className="m-0 mt-4 text-[32px] font-medium leading-[1.1] tracking-[-0.035em] md:text-[42px]">
              {hello}
              {firstName ? `, ${firstName}` : ""}.
              <br />
              <span className="gold-text">{headline}</span>
            </h1>
            <p className="m-0 mt-3 max-w-2xl text-[15px] text-white/85">{summary}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <AskElliotButton compact onDark />
            <a href="/dashboard/calendar" className="inline-flex h-11 items-center gap-2 rounded-full border border-white/30 bg-[#071a3a]/45 px-5 text-[14px] font-medium text-white no-underline backdrop-blur-sm hover:bg-[#071a3a]/60">
              <CalendarDays size={17} aria-hidden="true" /> Open calendar
            </a>
            <a href="/dashboard/inbox" className={`${btn.primary} !h-11 !px-5 !text-[14px]`}>
              Open inbox <ArrowRight size={17} aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      {statsError && <p className="relative -mt-16 mb-12 text-[13px] text-alert">Couldn&apos;t load the figures: {statsError.message}</p>}

      {/* ── Figures, overlapping the band ── */}
      <div className="relative -mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {figures.map((f) => {
          const Icon = f.icon;
          return (
            <a key={f.label} href={f.href} className="card block p-5 no-underline transition-shadow hover:shadow-lift">
              <span className="flex items-center gap-2.5">
                <span className="gold-tile h-9 w-9 rounded-[11px]">
                  <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                </span>
                <span className="text-[13.5px] font-medium text-gray-600">{f.label}</span>
              </span>
              <span className="mt-4 flex items-end justify-between gap-3">
                <span className="tabular block text-[34px] font-semibold leading-none tracking-[-0.03em] text-ink">{f.value}</span>
                {f.chart}
              </span>
              <span className="mt-2.5 block truncate">{f.note}</span>
            </a>
          );
        })}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,0.95fr)]">
        {/* ── Your queue ── */}
        <section className={panel} aria-label="Your queue">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className={panelTitle}>Your queue</h2>
            <a href="/dashboard/inbox" className={panelLink}>
              Inbox <ChevronRight size={14} aria-hidden="true" />
            </a>
          </div>

          {focus ? (
            <a href={focus.href} className="mb-4 block rounded-2xl bg-[linear-gradient(135deg,#071631,#14325c)] p-4 text-white no-underline shadow-lift">
              <span className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#ffc9c3]">{focus.kicker}</span>
                <span className="text-[12px] text-white/60">{focus.meta}</span>
              </span>
              <span className="mt-1.5 block truncate text-[15px] font-semibold">{focus.title}</span>
              {focus.body && <span className="mt-1 line-clamp-2 block text-[13px] text-white/75">{focus.body}</span>}
            </a>
          ) : (
            <div className="mb-4 flex items-center gap-3 rounded-2xl bg-[linear-gradient(135deg,#071631,#14325c)] p-4 text-[13.5px] text-white">
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#0b1426] ring-1 ring-gold/60">
                <ElliotMarkSmall />
              </span>
              Nothing urgent. Elliot has it covered.
            </div>
          )}

          <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-2 p-0">
            {queue.map((q) => {
              const Icon = q.icon;
              return (
                <li key={q.label}>
                  <a href={q.href} className={row}>
                    <span className="gold-tile h-9 w-9 rounded-[11px]">
                      <Icon size={17} strokeWidth={1.75} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 text-[14px] font-medium text-ink">{q.label}</span>
                    <span className={`tabular flex h-7 min-w-[28px] items-center justify-center rounded-full px-2 text-[13px] font-bold ${q.count === 0 ? "text-gray-500" : COUNT_PILL[q.tone]}`}>
                      {q.count}
                    </span>
                    <ChevronRight size={15} aria-hidden="true" className="text-gray-400" />
                  </a>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ── Today and recent activity ── */}
        <section className={panel} aria-label="Today">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className={panelTitle}>Today</h2>
            <a href="/dashboard/calendar" className={panelLink}>
              {todays.length ? plural(todays.length, "viewing") : "Calendar"} <ChevronRight size={14} aria-hidden="true" />
            </a>
          </div>
          {todays.length === 0 ? (
            <p className="m-0 rounded-2xl bg-[#f3f6fb] px-4 py-4 text-[13.5px] text-gray-600">Nothing booked for today.</p>
          ) : (
            <ol className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-2 p-0">
              {todays.slice(0, 5).map((a: any) => {
                const done = new Date(a.ends_at) <= now;
                const next = nextViewing && a.id === nextViewing.id;
                return (
                  <li key={a.id}>
                    <a href={`/dashboard/appointments/${a.id}`} className={`${row} ${next ? "!border-gold/50 !bg-white shadow-card" : ""}`}>
                      <span className={`tabular w-12 flex-shrink-0 text-[15px] font-bold ${done ? "text-gray-400" : "text-ink"}`}>{timeOf(a.starts_at, tz)}</span>
                      <span aria-hidden="true" className={`w-[3px] self-stretch rounded-full ${done ? "bg-gray-300" : "bg-[linear-gradient(#f3d4a4,#b97e47)]"}`} />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-[14px] font-semibold ${done ? "text-gray-500" : "text-ink"}`}>{contactLabel(a.contact)}</span>
                        <span className="mt-0.5 flex items-center gap-1 truncate text-[12.5px] text-gray-500">
                          <MapPin size={12} aria-hidden="true" className="flex-shrink-0" />
                          <span className="truncate">{[a.listing?.title || a.notes, a.agent ? `with ${personName(a.agent)}` : "no agent yet"].filter(Boolean).join(" · ")}</span>
                        </span>
                      </span>
                      {a.agent ? (
                        <span className="gold-fill flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-ink" title={personName(a.agent)}>
                          {initialsOf(a.agent)}
                        </span>
                      ) : (
                        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-dashed border-gray-300 text-gray-400" title="No agent yet">
                          <UserX size={14} aria-hidden="true" />
                        </span>
                      )}
                    </a>
                  </li>
                );
              })}
              {todays.length > 5 && (
                <li>
                  <a href="/dashboard/calendar" className="block px-3 pt-1 text-[12.5px] font-medium text-brass-dark no-underline">
                    and {plural(todays.length - 5, "more viewing")} today
                  </a>
                </li>
              )}
            </ol>
          )}

          <div className="mb-3 mt-6 flex items-center justify-between gap-3">
            <h2 className={panelTitle}>Recent activity</h2>
          </div>
          {activity.length === 0 ? (
            <p className="m-0 text-[13.5px] text-gray-500">Nothing has happened yet.</p>
          ) : (
            <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-2 p-0">
              {activity.slice(0, 5).map((item, i) => {
                const Icon = ACTIVITY_ICON[item.kind];
                return (
                  <li key={i}>
                    <a href={item.href} className={row}>
                      <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] ${item.kind === "Handover" ? "bg-alert-soft text-alert-dark" : "bg-[#0b1426] text-gold-light"}`}>
                        <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] font-semibold text-ink">{item.kind}</span>
                        <span className="block truncate text-[12.5px] text-gray-500">{item.text}</span>
                      </span>
                      <span className="whitespace-nowrap text-[12px] text-gray-500">{timeAgo(item.createdAt)}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── Pipeline and where chats came from ── */}
        <section className={`${panel} lg:col-span-2 xl:col-span-1`} aria-label="Leads by stage">
          <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-1">
            <div>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className={panelTitle}>Pipeline</h2>
                <a href="/dashboard/leads" className={panelLink}>
                  Leads <ChevronRight size={14} aria-hidden="true" />
                </a>
              </div>
              <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-3 p-0">
                {stageCounts.map(({ stage, count }) => (
                  <li key={stage}>
                    <a href={`/dashboard/leads?status=${stage}`} className="group grid grid-cols-[88px_1fr_28px] items-center gap-3 no-underline">
                      <span className="text-[13px] font-medium text-gray-700 group-hover:text-ink">{humanize(stage)}</span>
                      <span className="h-2.5 overflow-hidden rounded-full bg-[#e8edf5]">
                        <span className="block h-full rounded-full" style={{ width: `${(count / maxStage) * 100}%`, background: STAGE_COLOR[stage] }} />
                      </span>
                      <span className="tabular text-right text-[13px] font-bold text-ink">{count}</span>
                    </a>
                  </li>
                ))}
              </ul>
              {revenue && revenue.avg_deal_value != null ? (
                <div className="mt-5 grid grid-cols-2 gap-3">
                  {[
                    ["Pipeline value", revenue.estimated_pipeline_value],
                    ["Closed, 30 days", revenue.estimated_closed_value],
                  ].map(([l, v]) => (
                    <div key={l as string} className="rounded-2xl bg-[linear-gradient(135deg,#071631,#14325c_60%,#2b5590)] p-3.5 text-white">
                      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/60">{l as string}</div>
                      <div className="tabular mt-1.5 text-[19px] font-semibold">{Number(v).toLocaleString("en-GB")}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mb-0 mt-5 text-[13px] text-gray-500">
                  Add your average deal value in{" "}
                  <a href="/dashboard/settings" className="font-medium text-brass-dark underline">
                    Settings
                  </a>{" "}
                  to see what your pipeline is worth.
                </p>
              )}
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className={panelTitle}>Where chats came from</h2>
                <span className="text-[12.5px] text-gray-500">This week</span>
              </div>
              {channelCounts.length === 0 ? (
                <p className="m-0 text-[13.5px] text-gray-500">No chats this week yet.</p>
              ) : (
                <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-2 p-0">
                  {channelCounts.map((c) => (
                    <li key={c.key}>
                      <a href="/dashboard/conversations?days=7" className={row}>
                        {c.key === "whatsapp" ? (
                          <BrandTile name="whatsapp" />
                        ) : c.key === "email" ? (
                          <BrandTile name="gmail" />
                        ) : (
                          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-[#0b1426] text-gold-light">
                            <MessageCircle size={15} strokeWidth={1.75} aria-hidden="true" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13.5px] font-semibold text-ink">{c.label}</span>
                          <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-[#e3e9f2]">
                            <span
                              className="block h-full rounded-full"
                              style={{ width: `${(c.count / maxChannel) * 100}%`, background: c.key === "whatsapp" ? "#25D366" : c.key === "email" ? "#EA4335" : "#14325C" }}
                            />
                          </span>
                        </span>
                        <span className="tabular w-8 text-right text-[13px] font-bold text-ink">{c.count}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Elliot's mark, small, for the "all clear" note. */
function ElliotMarkSmall() {
  return <ElliotMark size={15} />;
}
