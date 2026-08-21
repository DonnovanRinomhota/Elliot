"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Appointment = {
  id: string;
  starts_at: string;
  ends_at: string;
  timezone: string | null;
  status: string;
  notes: string | null;
  contact: { name: string | null; email: string | null; phone: string | null } | null;
};

export default function AppointmentCard({ appointment }: { appointment: Appointment }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCancelled = appointment.status === "cancelled";

  async function handleCancel() {
    setBusy(true);
    setError(null);

    // Direct table update -- same RLS assumption as leads (relies on an
    // UPDATE policy existing alongside the SELECT one for appointments).
    const { error: updateError } = await supabase
      .from("appointments")
      .update({ status: "cancelled" })
      .eq("id", appointment.id);

    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.refresh();
  }

  const opts: Intl.DateTimeFormatOptions = {
    timeZone: appointment.timezone || "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  };

  return (
    <div
      style={{
        background: "white",
        border: "1px solid #eee",
        borderRadius: 10,
        padding: 20,
        opacity: isCancelled ? 0.6 : 1,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <div>
          <strong>{appointment.contact?.name || appointment.contact?.email || "Unknown contact"}</strong>
          <span style={{ marginLeft: 8, fontSize: 12, color: "#999" }}>
            {appointment.contact?.email} {appointment.contact?.phone ? `· ${appointment.contact.phone}` : ""}
          </span>
        </div>
        <span style={{ fontSize: 12, color: "#999" }}>{appointment.status}</span>
      </div>

      <div style={{ fontSize: 14, marginBottom: 8 }}>
        {new Date(appointment.starts_at).toLocaleString("en-GB", opts)} -{" "}
        {new Date(appointment.ends_at).toLocaleString("en-GB", { ...opts, dateStyle: undefined })}
        {appointment.timezone ? ` (${appointment.timezone})` : ""}
      </div>

      {appointment.notes && (
        <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>{appointment.notes}</p>
      )}

      {error && <p style={{ color: "crimson", fontSize: 13, marginBottom: 8 }}>{error}</p>}

      {!isCancelled && (
        <button
          onClick={handleCancel}
          disabled={busy}
          style={{ padding: "6px 12px", background: "white", color: "crimson", border: "1px solid #fbb", borderRadius: 6, fontSize: 13, cursor: "pointer" }}
        >
          Cancel appointment
        </button>
      )}
    </div>
  );
}
