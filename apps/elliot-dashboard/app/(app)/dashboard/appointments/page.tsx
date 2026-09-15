import { createClient } from "@/lib/supabase/server";
import AppointmentCard from "./appointment-card";
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
    return <p className="text-sm text-red-700">Failed to load appointments: {error.message}</p>;
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

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold text-ink">Appointments</h1>
      <p className="mb-4 text-sm text-gray-500">
        {scoped.length} total this view
        {days && (
          <>
            {" "}
            · filtered to bookings from the last {days} days ·{" "}
            <a href="/dashboard/appointments" className="text-indigo-600 hover:underline">
              clear filter
            </a>
          </>
        )}
      </p>

      <FolderTabs
        tabs={tabs}
        activeKey={activeStatus}
        basePath="/dashboard/appointments"
        extraParams={days ? { days: String(days) } : {}}
      />

      {visible.length === 0 && <p className="text-sm text-gray-400">No appointments in this folder.</p>}

      <div className="flex flex-col gap-3">
        {visible.map((appointment: any) => (
          <AppointmentCard key={appointment.id} appointment={appointment} />
        ))}
      </div>
    </div>
  );
}
