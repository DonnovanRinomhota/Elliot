import { createClient } from "@/lib/supabase/server";
import AppointmentCard from "./appointment-card";
import { APPOINTMENT_GRID } from "./grid";
import { EmptyState, PageHeader } from "../../../_ui/ui";
import FolderTabs, { FolderTab } from "../folder-tabs";

// Matches appointment-card.tsx's STATUS_STYLES exactly -- these are the
// real values the "Cancel / Mark completed / Mark no-show" buttons set.
const STATUS_TABS: FolderTab[] = [
  { key: "confirmed", label: "Confirmed", count: 0, tone: "info" },
  { key: "completed", label: "Completed", count: 0, tone: "success" },
  { key: "no_show", label: "No-show", count: 0, tone: "danger" },
  { key: "cancelled", label: "Cancelled", count: 0, tone: "neutral" },
  { key: "rescheduled", label: "Rescheduled", count: 0, tone: "warning" },
];

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: { status?: string; days?: string };
}) {
  const supabase = createClient();

  const { data: appointments, error } = await supabase
    .from("appointments")
    .select("id, starts_at, ends_at, timezone, status, notes, created_at, contact:contacts(name, email, phone)")
    .order("starts_at", { ascending: false });

  if (error) {
    return <p className="text-[13px] text-alert">Failed to load appointments: {error.message}</p>;
  }

  const days = searchParams.days ? Number(searchParams.days) : null;
  const cutoff = days ? Date.now() - days * 24 * 60 * 60 * 1000 : null;
  const scoped = cutoff ? (appointments ?? []).filter((a: any) => new Date(a.created_at).getTime() >= cutoff) : appointments ?? [];

  const tabs: FolderTab[] = [
    { key: "all", label: "All", count: scoped.length, tone: "neutral" },
    ...STATUS_TABS.map((t) => ({ ...t, count: scoped.filter((a: any) => a.status === t.key).length })),
  ];

  const activeStatus = tabs.some((t) => t.key === searchParams.status) ? (searchParams.status as string) : "all";
  const visible = activeStatus === "all" ? scoped : scoped.filter((a: any) => a.status === activeStatus);

  // Upcoming first (soonest at the top), then past (most recent first).
  const nowMs = Date.now();
  const upcoming = visible
    .filter((a: any) => new Date(a.ends_at).getTime() >= nowMs)
    .sort((a: any, b: any) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  const past = visible
    .filter((a: any) => new Date(a.ends_at).getTime() < nowMs)
    .sort((a: any, b: any) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());

  const table = (title: string, rows: any[]) =>
    rows.length > 0 && (
      <section className="mb-6">
        <h2 className="m-0 mb-2 text-[14px] font-semibold text-ink">
          {title} <span className="tabular font-normal text-gray-400">{rows.length}</span>
        </h2>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className={`hidden border-b border-gray-200 bg-gray-50 px-5 py-2.5 text-[12px] font-medium text-gray-500 ${APPOINTMENT_GRID}`}>
            <span>When</span>
            <span>Client</span>
            <span>Notes</span>
            <span>Status</span>
            <span className="sr-only">Actions</span>
          </div>
          <ul className="m-0 list-none p-0">
            {rows.map((appointment: any) => (
              <AppointmentCard key={appointment.id} appointment={appointment} />
            ))}
          </ul>
        </div>
      </section>
    );

  return (
    <div>
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
            "Viewings Elliot has booked into your calendar. Cancelling here also removes the calendar event."
          )
        }
      />

      <FolderTabs
        tabs={tabs}
        activeKey={activeStatus}
        basePath="/dashboard/appointments"
        extraParams={days ? { days: String(days) } : {}}
      />

      {visible.length === 0 ? (
        <EmptyState title="No appointments here">Viewings appear as soon as Elliot books one with a client.</EmptyState>
      ) : (
        <>
          {table("Upcoming", upcoming)}
          {table("Past", past)}
        </>
      )}
    </div>
  );
}
