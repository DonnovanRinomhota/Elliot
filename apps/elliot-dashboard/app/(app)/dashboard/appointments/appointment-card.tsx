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

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-blue-50 text-blue-700",
  completed: "bg-pulse-soft text-pulse-dark",
  cancelled: "bg-gray-100 text-gray-500",
  no_show: "bg-coral-soft text-coral-dark",
  rescheduled: "bg-amber-soft text-amber-dark",
};

export default function AppointmentCard({ appointment }: { appointment: Appointment }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isPast = new Date(appointment.starts_at).getTime() <= Date.now();
  const isCancelled = appointment.status === "cancelled";
  const isFinal = ["cancelled", "completed", "no_show"].includes(appointment.status);

  // Cancelling goes through the server (workflow 30) so the Google Calendar
  // event is removed too -- see app/api/appointments/[id]/cancel/route.ts.
  async function cancel() {
    if (!window.confirm("Cancel this appointment? It will also be removed from the calendar.")) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    let data: { success: boolean; error?: string; calendar?: string } | null = null;
    try {
      const res = await fetch(`/api/appointments/${appointment.id}/cancel`, { method: "POST" });
      data = await res.json();
    } catch (e) {
      setBusy(false);
      setError((e as Error).message);
      return;
    }

    setBusy(false);
    if (!data?.success) {
      setError(data?.error || "Couldn't cancel this appointment.");
      return;
    }
    if (data.calendar === "failed") {
      setNotice("Cancelled, but the Google Calendar event couldn't be removed. Please delete it from the calendar by hand.");
    } else if (data.calendar === "not_configured") {
      setNotice("Cancelled in Elliot only. Calendar removal isn't set up yet, so please delete the event from the calendar by hand.");
    }
    router.refresh();
  }

  async function setStatus(status: string) {
    setBusy(true);
    setError(null);

    const { error: updateError } = await supabase.from("appointments").update({ status }).eq("id", appointment.id);

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
    <div className={`rounded-xl border border-gray-200 bg-white p-5 ${isCancelled ? "opacity-60" : ""}`}>
      <div className="mb-2 flex items-start justify-between">
        <div>
          <span className="font-medium">{appointment.contact?.name || appointment.contact?.email || "Unknown contact"}</span>
          <span className="ml-2 text-xs text-gray-400">
            {appointment.contact?.email} {appointment.contact?.phone ? `· ${appointment.contact.phone}` : ""}
          </span>
        </div>
        <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[appointment.status] || "bg-gray-100 text-gray-600"}`}>
          {appointment.status.replace("_", " ")}
        </span>
      </div>

      <div className="mb-2 text-sm">
        {new Date(appointment.starts_at).toLocaleString("en-GB", opts)} –{" "}
        {new Date(appointment.ends_at).toLocaleString("en-GB", { ...opts, dateStyle: undefined })}
        {appointment.timezone ? ` (${appointment.timezone})` : ""}
      </div>

      {appointment.notes && <p className="mb-3 text-sm text-gray-500">{appointment.notes}</p>}

      {error && <p className="mb-2 text-xs text-red-700">{error}</p>}
      {notice && <p className="mb-2 rounded-md bg-amber-soft px-2.5 py-1.5 text-xs text-amber-dark">{notice}</p>}

      <div className="flex flex-wrap gap-2">
        {!isFinal && !isPast && (
          <button
            onClick={cancel}
            disabled={busy}
            className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Cancel appointment
          </button>
        )}
        {!isFinal && isPast && (
          <>
            <button
              onClick={() => setStatus("completed")}
              disabled={busy}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50"
            >
              Mark completed
            </button>
            <button
              onClick={() => setStatus("no_show")}
              disabled={busy}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50"
            >
              Mark no-show
            </button>
          </>
        )}
      </div>
    </div>
  );
}
