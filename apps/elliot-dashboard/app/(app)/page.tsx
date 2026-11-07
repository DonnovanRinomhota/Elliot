import { redirect } from "next/navigation";
import { CalendarDays, ChevronRight, Flame, Inbox, Mail, MessageCircle, UserX, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { contactLabel } from "@/lib/contacts";
import { getMembership } from "@/lib/tenant";
import { DEFAULT_TZ, addDays, dayKey, personName, timeOf } from "@/lib/appointments";
import { listingPhotos } from "@/lib/listing-photos";
import { resizedPhotoUrl } from "@/lib/google-drive";
import { AreaLine, Gauge } from "../_ui/charts";
import { btn, humanize, timeAgo } from "../_ui/ui";
import { AskElliotButton } from "./dashboard/ask-elliot";

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
    // For the charts: 14 days of chats, 28 days of leads, 60 days of bookings.
    supabase.from("conversations").select("created_at").gte("created_at", ago(14)),
    supabase.from("leads").select("created_at").gte("created_at", ago(28)),
    supabase.from("appointments").select("created_at").gte("created_at", ago(60)),
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

  // ── Greeting ──
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = (me?.full_name || user.email || "").split(/[\s@]/)[0];

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
  const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

  const week = daysBack(7);
  const convWeek = perDay(convRows as any, week);
  const convNow = sum(convWeek);
  const convBefore = inRange(convRows as any, addDays(today, -13), addDays(today, -6));
  const convChange = change(convNow, convBefore);
  const handovers = Number(stats?.escalations_count ?? 0);
  const leadsNew = Number(stats?.new_leads_count ?? 0);
  const viewingsBooked = Number(stats?.appointments_booked_count ?? 0);
  const maxBar = Math.max(1, ...convWeek);

  const fortnight = daysBack(14);
  const leadSeries = perDay(leadRows as any, fortnight);
  const leadsNow = sum(leadSeries);
  const leadsBefore = inRange(leadRows as any, addDays(today, -27), addDays(today, -13));
  const leadChange = change(leadsNow, leadsBefore);

  const month = daysBack(30);
  const bookedSeries = perDay(bookedRows as any, month);
  const bookedNow = sum(bookedSeries);
  const bookedBefore = inRange(bookedRows as any, addDays(today, -59), addDays(today, -29));
  const bookedChange = change(bookedNow, bookedBefore);

  // Highlight the latest day, unless it's empty and an earlier day was busier.
  const busiest = (a: number[]) => (a[a.length - 1] > 0 ? a.length - 1 : a.reduce((best, v, i) => (v > a[best] ? i : best), a.length - 1));
  const bestLeadDay = busiest(leadSeries);
  const bestBookedDay = busiest(bookedSeries);

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

  const ChangePill = ({ c, label }: { c: ReturnType<typeof change>; label: string }) =>
    c ? (
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium ${c.up ? "bg-accent-soft text-accent-dark" : "bg-gray-100 text-gray-600"}`}>
        {c.up ? "↑" : "↓"} {c.text} <span className="font-normal opacity-75">{label}</span>
      </span>
    ) : null;

  return (
    <div>
      {/* Greeting */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="m-0 text-[12px] font-medium uppercase tracking-[0.08em] text-gray-400">
            {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: tz })}
          </p>
          <h1 className="m-0 mt-1 text-[30px] font-semibold leading-tight tracking-[-0.03em] text-ink md:text-[34px]">
            {greeting}
            {firstName ? `, ${firstName.charAt(0).toUpperCase()}${firstName.slice(1)}` : ""}
          </h1>
          <p className="m-0 mt-1.5 max-w-2xl text-[15px] text-gray-500">{summary}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-9 items-center gap-2 rounded-full border border-gray-200 bg-white px-4 text-[13px] text-gray-600 shadow-sm">
            <CalendarDays size={15} aria-hidden="true" /> Last 7 days
          </span>
          <AskElliotButton compact />
          <a href="/dashboard/listings/new" className={btn.primary}>
            + Add listing
          </a>
        </div>
      </header>

      {statsError && <p className="mb-4 text-[13px] text-alert">Couldn&apos;t load the figures: {statsError.message}</p>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* ── My queue ── */}
        <section className="card flex flex-col p-5 lg:row-span-2" aria-label="Your queue">
          <div className="flex items-center justify-between gap-3">
            <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em] text-ink">Your queue</h2>
            <a href="/dashboard/inbox" className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 text-[12.5px] text-ink no-underline hover:bg-gray-50">
              Inbox <ChevronRight size={14} aria-hidden="true" />
            </a>
          </div>

          {focus ? (
            <a href={focus.href} className="mt-4 block overflow-hidden rounded-2xl border border-gray-100 bg-white no-underline shadow-card hover:border-gray-200">
              <div className="flex">
                <span aria-hidden="true" className="w-1.5 flex-shrink-0 bg-accent" />
                <div className="min-w-0 flex-1 px-4 py-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[14px] font-semibold text-ink">{focus.title}</span>
                    <span className="flex-shrink-0 rounded-full bg-alert-soft px-2 py-0.5 text-[11.5px] font-medium text-alert-dark">● Urgent</span>
                  </div>
                  <p className="m-0 mt-1 text-[12px] font-medium text-alert">{focus.kicker}</p>
                  {focus.body && <p className="m-0 mt-1 line-clamp-2 text-[12.5px] text-gray-500">{focus.body}</p>}
                  <p className="m-0 mt-2 text-[12px] text-gray-400">{focus.meta}</p>
                </div>
              </div>
            </a>
          ) : (
            <div className="mt-4 rounded-2xl bg-accent-soft px-4 py-4 text-[13.5px] text-accent-dark">Nothing urgent. Elliot has it covered.</div>
          )}

          <div className="mt-5 flex items-center justify-between border-b border-gray-100 pb-2.5">
            <span className="text-[13px] font-medium text-ink">Waiting on your team</span>
            <span className="tabular text-[13px] font-semibold text-ink">{queueTotal}</span>
          </div>
          <ul className="m-0 list-none p-0">
            {queue.map((q) => {
              const Icon = q.icon;
              return (
                <li key={q.label}>
                  <a href={q.href} className="flex items-center gap-3 border-b border-gray-50 py-2.5 no-underline hover:bg-gray-50/60">
                    <Icon size={16} strokeWidth={1.75} aria-hidden="true" className="text-gray-400" />
                    <span className="flex-1 text-[13.5px] text-gray-700">{q.label}</span>
                    <span
                      className={`tabular min-w-[26px] rounded-full px-2 text-center text-[12.5px] font-semibold leading-6 ${
                        q.count === 0 ? "text-gray-300" : q.tone === "alert" ? "bg-alert-soft text-alert-dark" : q.tone === "brass" ? "bg-brass-soft text-brass-dark" : "bg-accent-soft text-accent-dark"
                      }`}
                    >
                      {q.count}
                    </span>
                    <ChevronRight size={14} aria-hidden="true" className="text-gray-300" />
                  </a>
                </li>
              );
            })}
          </ul>

          <div className="mt-auto pt-5">
            <a href="/dashboard/calendar" className="flex items-center gap-3 rounded-2xl bg-gray-50 px-4 py-3 no-underline hover:bg-gray-100">
              <CalendarDays size={17} strokeWidth={1.75} className="flex-shrink-0 text-accent" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-ink">
                  {todays.length ? `${plural(todays.length, "viewing")} today` : "No viewings today"}
                </span>
                <span className="block truncate text-[12px] text-gray-500">
                  {nextViewing ? `Next at ${timeOf(nextViewing.starts_at, tz)}, ${contactLabel(nextViewing.contact)}` : todays.length ? "All done for today" : "Your calendar is free"}
                </span>
              </span>
              <span className="text-[12.5px] font-medium text-accent">Open</span>
            </a>
          </div>
        </section>

        {/* ── Conversations ── */}
        <section className="card p-5" aria-label="Conversations">
          <div className="flex items-center justify-between gap-3">
            <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em] text-ink">Conversations</h2>
            <a href="/dashboard/conversations?days=7" className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 text-[12.5px] text-ink no-underline hover:bg-gray-50">
              View <ChevronRight size={14} aria-hidden="true" />
            </a>
          </div>
          <div className="mt-3 rounded-2xl bg-gray-50 p-4">
            <div className="flex items-end gap-3">
              <span className="tabular text-[40px] font-semibold leading-none tracking-[-0.03em] text-ink">{convNow}</span>
              <span className="pb-1 text-[12.5px] leading-tight text-gray-500">
                chats this week
                <br />
                <ChangePill c={convChange} label="vs last week" />
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-3 divide-x divide-gray-200 text-[12px]">
              {[
                ["New leads", leadsNew, "text-ink"],
                ["Viewings", viewingsBooked, "text-ink"],
                ["Handed over", handovers, handovers ? "text-alert" : "text-ink"],
              ].map(([l, v, c]) => (
                <div key={l as string} className="px-2 first:pl-0">
                  <dd className={`tabular m-0 text-[17px] font-semibold ${c}`}>{v as number}</dd>
                  <dt className="text-gray-500">{l as string}</dt>
                </div>
              ))}
            </dl>
          </div>
          <div className="mt-4 flex h-[92px] items-end justify-between gap-2">
            {week.map((d, i) => (
              <a key={d} href={`/dashboard/conversations?date=${d}`} title={`${convWeek[i]} on ${short(d)}`} className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5 no-underline">
                <span
                  className={`w-full max-w-[34px] rounded-lg ${d === today ? "bg-accent" : "bg-accent-100"} group-hover:opacity-80`}
                  style={{ height: `${Math.max(6, (convWeek[i] / maxBar) * 70)}px` }}
                />
                <span className={`text-[11px] ${d === today ? "font-medium text-ink" : "text-gray-400"}`}>
                  {new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}
                </span>
              </a>
            ))}
          </div>
        </section>

        {/* ── Gauge: handled by Elliot ── */}
        <section className="card flex flex-col p-5" aria-label="Handled by Elliot">
          <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em] text-ink">Handled by Elliot</h2>
          <div className="mt-4">
            <Gauge
              segments={[
                { value: handledByElliot, color: "#2563EB" },
                { value: handovers, color: "#F59E0B" },
              ]}
              value={elliotRate == null ? "–" : `${elliotRate}%`}
              caption="of this week's chats"
            />
          </div>
          <ul className="m-0 mt-3 flex list-none flex-wrap justify-center gap-x-4 gap-y-1 p-0 text-[12px] text-gray-600">
            <li className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" /> By Elliot <b className="tabular font-semibold text-ink">{handledByElliot}</b>
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#F59E0B]" aria-hidden="true" /> Handed to a person <b className="tabular font-semibold text-ink">{handovers}</b>
            </li>
          </ul>
          <a href="/dashboard/escalations?status=open" className="mt-auto block rounded-full bg-gray-50 py-2.5 text-center text-[13px] font-medium text-ink no-underline hover:bg-gray-100">
            {waitingChats ? `Review ${plural(waitingChats, "open handover")}` : "No open handovers"} ›
          </a>
        </section>

        {/* ── Leads received ── */}
        <section className="card p-5" aria-label="Leads received">
          <div className="flex items-center justify-between gap-3">
            <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em] text-ink">Leads received</h2>
            <a href="/dashboard/leads?days=14" className="text-[12.5px] text-gray-500 no-underline hover:text-ink">
              Last 14 days
            </a>
          </div>
          <div className="mt-7">
            <AreaLine
              values={leadSeries}
              labels={fortnight.map(short)}
              height={130}
              highlight={bestLeadDay}
              label={`${short(fortnight[bestLeadDay])} · ${leadSeries[bestLeadDay]} received`}
              axis={[short(fortnight[0]), short(fortnight[7]), short(today)]}
            />
          </div>
          <div className="mt-3 flex items-end gap-3">
            <span className="tabular text-[34px] font-semibold leading-none tracking-[-0.03em] text-ink">{leadsNow}</span>
            <ChangePill c={leadChange} label="vs prior 14 days" />
          </div>
        </section>

        {/* ── Viewings booked (blue card) ── */}
        <section className="rounded-[18px] bg-gradient-to-br from-accent to-[#1E4FD8] p-5 text-white shadow-card" aria-label="Viewings booked">
          <div className="flex items-center justify-between gap-3">
            <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em]">Viewings booked</h2>
            <a href="/dashboard/appointments?view=calendar" className="text-[12.5px] text-white/75 no-underline hover:text-white">
              Last 30 days
            </a>
          </div>
          <div className="mt-7">
            <AreaLine
              values={bookedSeries}
              labels={month.map(short)}
              height={130}
              tone="onBlue"
              highlight={bestBookedDay}
              label={`${short(month[bestBookedDay])} · ${bookedSeries[bestBookedDay]} booked`}
              axis={[short(month[0]), short(month[15]), short(today)]}
            />
          </div>
          <div className="mt-3 flex items-end gap-3">
            <span className="tabular text-[34px] font-semibold leading-none tracking-[-0.03em]">{bookedNow}</span>
            {bookedChange && (
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-[12px] font-medium">
                {bookedChange.up ? "↑" : "↓"} {bookedChange.text} <span className="font-normal opacity-80">vs prior 30 days</span>
              </span>
            )}
          </div>
        </section>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* ── Today ── */}
        <section className="card p-5" aria-label="Today">
          <div className="flex items-center justify-between gap-3">
            <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em] text-ink">Today</h2>
            <a href="/dashboard/calendar" className="text-[12.5px] text-gray-500 no-underline hover:text-ink">
              {plural(todays.length, "viewing")}
            </a>
          </div>
          {todays.length === 0 ? (
            <p className="m-0 mt-4 text-[13px] text-gray-500">Nothing booked for today.</p>
          ) : (
            <ol className="m-0 mt-4 list-none p-0">
              {todays.map((a: any, i: number) => {
                const cover = a.listing ? listingPhotos(a.listing)[0] : undefined;
                const done = new Date(a.ends_at) <= now;
                return (
                  <li key={a.id} className="grid grid-cols-[48px_16px_minmax(0,1fr)] gap-2">
                    <span className={`tabular pt-1 text-[12.5px] font-medium ${done ? "text-gray-400" : "text-accent"}`}>{timeOf(a.starts_at, tz)}</span>
                    <span className="relative flex justify-center" aria-hidden="true">
                      <span className={`mt-2 h-2.5 w-2.5 rounded-full ${done ? "bg-gray-300" : "bg-accent ring-4 ring-accent-soft"}`} />
                      {i < todays.length - 1 && <span className="absolute bottom-0 top-5 w-px bg-gray-200" />}
                    </span>
                    <a href={`/dashboard/appointments/${a.id}`} className="mb-3 flex min-w-0 items-center gap-3 rounded-xl px-1 py-0.5 no-underline hover:bg-gray-50">
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={resizedPhotoUrl(cover, 120)} alt="" className="h-9 w-9 flex-shrink-0 rounded-lg object-cover" />
                      ) : (
                        <span className="h-9 w-9 flex-shrink-0 rounded-lg bg-gray-100" aria-hidden="true" />
                      )}
                      <span className="min-w-0">
                        <span className={`block truncate text-[13.5px] font-medium ${done ? "text-gray-500" : "text-ink"}`}>{contactLabel(a.contact)}</span>
                        <span className="block truncate text-[12px] text-gray-500">
                          {[a.listing?.title || a.notes, a.agent ? personName(a.agent) : "no agent yet"].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* ── Recent activity ── */}
        <section className="card p-5" aria-label="Recent activity">
          <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em] text-ink">Recent activity</h2>
          {activity.length === 0 ? (
            <p className="m-0 mt-4 text-[13px] text-gray-500">Nothing has happened yet.</p>
          ) : (
            <ul className="m-0 mt-3 list-none p-0">
              {activity.map((item, i) => (
                <li key={i}>
                  <a href={item.href} className="flex items-center gap-3 rounded-xl px-1 py-2 no-underline hover:bg-gray-50">
                    <span
                      className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        item.kind === "Handover" ? "bg-alert-soft text-alert-dark" : item.kind === "Email" ? "bg-brass-soft text-brass-dark" : "bg-accent-soft text-accent-dark"
                      }`}
                    >
                      {item.kind}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{item.text}</span>
                    <span className="whitespace-nowrap text-[12px] text-gray-400">{timeAgo(item.createdAt)}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Pipeline ── */}
        <section className="card p-5" aria-label="Leads by stage">
          <div className="flex items-center justify-between gap-3">
            <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em] text-ink">Pipeline</h2>
            <a href="/dashboard/leads" className="inline-flex items-center gap-1 text-[12.5px] text-gray-500 no-underline hover:text-ink">
              <Users size={14} aria-hidden="true" /> All leads
            </a>
          </div>
          <ul className="m-0 mt-4 grid list-none gap-2.5 p-0">
            {stageCounts.map(({ stage, count }) => (
              <li key={stage}>
                <a href={`/dashboard/leads?status=${stage}`} className="group grid grid-cols-[84px_1fr_28px] items-center gap-3 no-underline">
                  <span className="text-[12.5px] text-gray-600 group-hover:text-ink">{humanize(stage)}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-gray-100">
                    <span className={`block h-full rounded-full ${stage === "HOT" ? "bg-alert" : stage === "WARM" ? "bg-[#F59E0B]" : "bg-accent"}`} style={{ width: `${(count / maxStage) * 100}%` }} />
                  </span>
                  <span className="tabular text-right text-[12.5px] font-medium text-ink">{count}</span>
                </a>
              </li>
            ))}
          </ul>
          {revenue && revenue.avg_deal_value != null ? (
            <div className="mt-5 grid grid-cols-2 gap-3 rounded-2xl bg-gray-50 p-3.5">
              <div>
                <div className="text-[12px] text-gray-500">Pipeline value</div>
                <div className="tabular text-[17px] font-semibold text-ink">{Number(revenue.estimated_pipeline_value).toLocaleString("en-GB")}</div>
              </div>
              <div>
                <div className="text-[12px] text-gray-500">Closed, 30 days</div>
                <div className="tabular text-[17px] font-semibold text-ink">{Number(revenue.estimated_closed_value).toLocaleString("en-GB")}</div>
              </div>
            </div>
          ) : (
            <p className="mb-0 mt-5 text-[12.5px] text-gray-500">
              Add your average deal value in{" "}
              <a href="/dashboard/settings" className="text-accent underline">
                Settings
              </a>{" "}
              to see what your pipeline is worth.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
