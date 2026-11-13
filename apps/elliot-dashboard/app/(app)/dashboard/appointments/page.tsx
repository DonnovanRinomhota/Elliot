import { createClient } from "@/lib/supabase/server";
import { APPOINTMENT_SELECT, DEFAULT_TZ, parseMonth, personName, todayKey, type Appointment, type TeamMember } from "@/lib/appointments";
import AppointmentCard from "./appointment-card";
import MonthCalendar from "./month-calendar";
import { APPOINTMENT_GRID } from "./grid";
import { EmptyState, PageHeader, Pagination, paginate } from "../../../_ui/ui";
import FolderTabs, { FolderTab } from "../folder-tabs";
import AgentSelect from "../agent-select";

// Matches the real values the "Cancel / Mark completed / Mark no-show"
// buttons set.
const STATUS_TABS: FolderTab[] = [
  { key: "confirmed", label: "Confirmed", count: 0, tone: "info" },
  { key: "completed", label: "Completed", count: 0, tone: "success" },
  { key: "no_show", label: "No-show", count: 0, tone: "danger" },
  { key: "cancelled", label: "Cancelled", count: 0, tone: "neutral" },
  { key: "rescheduled", label: "Rescheduled", count: 0, tone: "warning" },
];

type Params = { status?: string; days?: string; page?: string; view?: string; month?: string; agent?: string };

export default async function AppointmentsPage({ searchParams }: { searchParams: Params }) {
  const supabase = createClient();

  const [{ data: appointments, error }, { data: team }, { data: tenant }] = await Promise.all([
    supabase.from("appointments").select(APPOINTMENT_SELECT).order("starts_at", { ascending: false }),
    supabase.from("tenant_users").select("id, full_name, email, role").is("removed_at", null).in("role", ["admin", "agent"]).order("full_name"),
    supabase.from("tenants").select("timezone").maybeSingle(),
  ]);

  if (error) {
    return <p className="text-[13px] text-alert">Failed to load appointments: {error.message}</p>;
  }

  const tz = (tenant as { timezone?: string } | null)?.timezone || DEFAULT_TZ;
  const today = todayKey(tz);
  const view = searchParams.view === "calendar" ? "calendar" : "list";
  const members = (team ?? []) as TeamMember[];
  const agent = searchParams.agent === "none" || members.some((m) => m.id === searchParams.agent) ? searchParams.agent! : "";

  const all = (appointments ?? []) as unknown as Appointment[];
  const days = searchParams.days ? Number(searchParams.days) : null;
  const cutoff = days ? Date.now() - days * 24 * 60 * 60 * 1000 : null;
  const scoped = all
    .filter((a) => !cutoff || new Date(a.created_at).getTime() >= cutoff)
    .filter((a) => (agent === "none" ? !a.agent_id : agent ? a.agent_id === agent : true));

  const tabs: FolderTab[] = [
    { key: "all", label: "All", count: scoped.length, tone: "neutral" },
    ...STATUS_TABS.map((t) => ({ ...t, count: scoped.filter((a) => a.status === t.key).length })),
  ];

  const activeStatus = tabs.some((t) => t.key === searchParams.status) ? (searchParams.status as string) : "all";
  const visible = activeStatus === "all" ? scoped : scoped.filter((a) => a.status === activeStatus);

  // Settings every link on this page keeps.
  const keep: Record<string, string> = {};
  if (days) keep.days = String(days);
  if (agent) keep.agent = agent;
  if (view === "calendar") keep.view = "calendar";
  const href = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams(keep);
    if (activeStatus !== "all") p.set("status", activeStatus);
    for (const [k, v] of Object.entries(extra)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const qs = p.toString();
    return `/dashboard/appointments${qs ? `?${qs}` : ""}`;
  };

  const agentOptions = [
    { value: "", label: "Everyone" },
    ...members.map((m) => ({ value: m.id, label: personName(m) })),
    { value: "none", label: "Unassigned" },
  ];

  const viewSwitch = (
    <div className="inline-flex rounded-full border border-gray-200 bg-glass p-0.5 shadow-sm" role="group" aria-label="View">
      {(["list", "calendar"] as const).map((v) => (
        <a
          key={v}
          href={href({ view: v === "calendar" ? "calendar" : undefined, page: undefined, month: undefined })}
          aria-current={view === v ? "page" : undefined}
          className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium no-underline ${view === v ? "bg-[#fff] text-navy" : "text-ink-600 hover:bg-ink-soft"}`}
        >
          {v === "list" ? "List" : "Calendar"}
        </a>
      ))}
    </div>
  );

  const header = (
    <PageHeader
      title="Appointments"
      description={
        days ? (
          <>
            {scoped.length} booking{scoped.length === 1 ? "" : "s"} made in the last {days} days.{" "}
            <a href="/dashboard/appointments" className="text-ink underline">
              Show all
            </a>
          </>
        ) : (
          "Viewings Elliot has booked, with the property, the client and the agent going. Cancelling here also removes the calendar event."
        )
      }
      actions={
        <>
          <AgentSelect options={agentOptions} value={agent} basePath="/dashboard/appointments" />
          {viewSwitch}
        </>
      }
      tabs={<FolderTabs tabs={tabs} activeKey={activeStatus} basePath="/dashboard/appointments" extraParams={keep} />}
    />
  );

  if (view === "calendar") {
    const month = parseMonth(searchParams.month, today);
    return (
      <div>
        {header}
        <MonthCalendar
          appointments={visible}
          month={month}
          today={today}
          tz={tz}
          hrefFor={(m) => href({ month: m === today.slice(0, 7) ? undefined : m })}
          weekHref={(day) => `/dashboard/calendar?week=${day}&agent=${agent && agent !== "none" ? agent : "all"}`}
          jumpParams={{ ...keep, ...(activeStatus !== "all" ? { status: activeStatus } : {}) }}
        />
      </div>
    );
  }

  // Upcoming first (soonest at the top), then past (most recent first).
  const nowMs = Date.now();
  const upcoming = visible
    .filter((a) => new Date(a.ends_at).getTime() >= nowMs)
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  const past = visible
    .filter((a) => new Date(a.ends_at).getTime() < nowMs)
    .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());

  // Upcoming first, then past; 20 per page across both, numbered in that order.
  const ordered = [...upcoming, ...past];
  const pg = paginate(ordered, searchParams.page);
  const numberOf = new Map(ordered.map((a, i) => [a.id, i + 1]));
  const upcomingIds = new Set(upcoming.map((a) => a.id));
  const pageUpcoming = pg.items.filter((a) => upcomingIds.has(a.id));
  const pagePast = pg.items.filter((a) => !upcomingIds.has(a.id));

  // Upcoming viewings are the work; past ones fold away (open when there's
  // nothing upcoming on this page).
  const table = (title: string, rows: Appointment[], total: number, fold = false) =>
    rows.length > 0 && (
      <details className="fold card mb-5 p-3 md:p-4" open={!fold}>
        <summary className="px-1.5 pb-1 pt-1">
          <span className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{title}</span>
          <span className="tabular rounded-full bg-gray-100 px-2 py-0.5 text-[12px] font-bold text-gray-600">{total}</span>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="fold-chevron flex-shrink-0 text-gray-500">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <div className="mt-2">
          <div className={`hidden px-3.5 pb-2 pt-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-gray-500 ${APPOINTMENT_GRID}`}>
            <span>#</span>
            <span>When</span>
            <span>Client</span>
            <span>Property</span>
            <span>Agent</span>
            <span>Status</span>
            <span className="sr-only">Actions</span>
          </div>
          <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-2 p-0">
            {rows.map((appointment) => (
              <AppointmentCard key={appointment.id} number={numberOf.get(appointment.id)} appointment={appointment} />
            ))}
          </ul>
        </div>
      </details>
    );

  return (
    <div>
      {header}
      {visible.length === 0 ? (
        <EmptyState title="No appointments here">Viewings appear as soon as Elliot books one with a client.</EmptyState>
      ) : (
        <>
          {table("Upcoming", pageUpcoming, upcoming.length)}
          {table("Past", pagePast, past.length, pageUpcoming.length > 0)}
        </>
      )}
      <Pagination
        {...pg}
        shown={pg.items.length}
        basePath="/dashboard/appointments"
        params={{ ...keep, status: activeStatus === "all" ? undefined : activeStatus }}
        noun="appointments"
      />
    </div>
  );
}
