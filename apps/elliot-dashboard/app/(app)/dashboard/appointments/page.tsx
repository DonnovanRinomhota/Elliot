import { createClient } from "@/lib/supabase/server";
import AppointmentCard from "./appointment-card";

export default async function AppointmentsPage() {
  const supabase = createClient();

  const { data: appointments, error } = await supabase
    .from("appointments")
    .select("id, starts_at, ends_at, timezone, status, notes, contact:contacts(name, email, phone)")
    .order("starts_at", { ascending: true });

  if (error) {
    return <p className="text-sm text-red-700">Failed to load appointments: {error.message}</p>;
  }

  const now = Date.now();
  // "Upcoming" = starts in the future AND still an active booking (not
  // cancelled). Everything else -- already happened, or cancelled regardless
  // of when it was booked for -- is history. completed/no_show are set by
  // staff after the fact; the DB doesn't do this automatically yet.
  const upcoming = (appointments ?? []).filter(
    (a: any) => new Date(a.starts_at).getTime() > now && a.status !== "cancelled"
  );
  const history = (appointments ?? []).filter(
    (a: any) => new Date(a.starts_at).getTime() <= now || a.status === "cancelled"
  );

  return (
    <div>
      <h1 className="mb-1 text-xl font-medium">Appointments</h1>
      <p className="mb-6 text-sm text-gray-500">
        {upcoming.length} upcoming, {history.length} in history
      </p>

      {appointments?.length === 0 && <p className="text-sm text-gray-400">No appointments yet.</p>}

      <div className="flex flex-col gap-3">
        {upcoming.map((appt: any) => (
          <AppointmentCard key={appt.id} appointment={appt} />
        ))}
        {upcoming.length === 0 && appointments && appointments.length > 0 && (
          <p className="text-sm text-gray-400">Nothing upcoming.</p>
        )}
      </div>

      {history.length > 0 && (
        <>
          <div className="mb-3 mt-8 text-sm font-medium text-gray-500">History</div>
          <div className="flex flex-col gap-3">
            {history
              .slice()
              .reverse()
              .map((appt: any) => (
                <AppointmentCard key={appt.id} appointment={appt} />
              ))}
          </div>
        </>
      )}
    </div>
  );
}
