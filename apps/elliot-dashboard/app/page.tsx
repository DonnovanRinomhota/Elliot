import { createClient } from "@/lib/supabase/server";
import AppointmentCard from "./appointment-card";

export default async function AppointmentsPage() {
  const supabase = createClient();

  const { data: appointments, error } = await supabase
    .from("appointments")
    .select("id, starts_at, ends_at, timezone, status, notes, contact:contacts(name, email, phone)")
    .order("starts_at", { ascending: true });

  if (error) {
    return <p style={{ color: "crimson" }}>Failed to load appointments: {error.message}</p>;
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Appointments</h1>
      <p style={{ color: "#666", marginBottom: 24, fontSize: 14 }}>
        {appointments?.length ?? 0} appointment{appointments?.length === 1 ? "" : "s"}
      </p>

      {(!appointments || appointments.length === 0) && <p style={{ color: "#999" }}>No appointments yet.</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {appointments?.map((appt: any) => (
          <AppointmentCard key={appt.id} appointment={appt} />
        ))}
      </div>
    </div>
  );
}
