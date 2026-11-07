"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { StatusBadge, btn } from "../../../_ui/ui";
import { APPOINTMENT_GRID } from "./grid";

type Appointment = {
  id: string;
  starts_at: string;
  ends_at: string;
  timezone: string | null;
  status: string;
  notes: string | null;
  contact: { name: string | null; email: string | null; phone: string | null } | null;
};

export default function AppointmentCard({ appointment, number }: { appointment: Appointment; number?: number }) {
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

  const tz = appointment.timezone || "UTC";
  const start = new Date(appointment.starts_at);
  const end = new Date(appointment.ends_at);
  const day = start.toLocaleDateString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" });
  const time = `${start.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" })}–${end.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" })}`;
  const name = appointment.contact?.name || appointment.contact?.email || "Unknown contact";
  const contactLine = [appointment.contact?.name ? appointment.contact?.email : null, appointment.contact?.phone].filter(Boolean).join(", ");

  return (
    <li className="border-t border-gray-200 first:border-t-0">
      <div className={`grid gap-1.5 px-5 py-3.5 ${APPOINTMENT_GRID}`}>
        <span className="tabular hidden text-[12.5px] text-gray-400 md:block">{number}</span>
        <div className={isFinal ? "text-gray-500" : "text-ink"}>
          <div className="text-[14px] font-medium">{day}</div>
          <div className="tabular text-[12.5px] text-gray-500">
            {time}
            {tz !== "Europe/Warsaw" ? ` (${tz})` : ""}
          </div>
        </div>

        <div className="min-w-0">
          <div className={`truncate text-[14px] ${isCancelled ? "text-gray-500 line-through decoration-gray-300" : "text-ink"}`}>{name}</div>
          {contactLine && <div className="truncate text-[12.5px] text-gray-500">{contactLine}</div>}
        </div>

        <div className="min-w-0 text-[13px] text-gray-600">{appointment.notes || <span className="text-gray-400">No notes</span>}</div>

        <div>
          <StatusBadge kind="appointment" value={appointment.status} />
        </div>

        <div className="flex flex-wrap gap-2 md:justify-end">
          {!isFinal && !isPast && (
            <button type="button" onClick={cancel} disabled={busy} className={`${btn.danger} ${btn.small}`}>
              Cancel
            </button>
          )}
          {!isFinal && isPast && (
            <>
              <button type="button" onClick={() => setStatus("completed")} disabled={busy} className={`${btn.secondary} ${btn.small}`}>
                Completed
              </button>
              <button type="button" onClick={() => setStatus("no_show")} disabled={busy} className={`${btn.secondary} ${btn.small}`}>
                No-show
              </button>
            </>
          )}
        </div>
      </div>

      {(error || notice) && (
        <div className="px-5 pb-3">
          {error && (
            <p className="m-0 text-[13px] text-alert" role="alert">
              {error}
            </p>
          )}
          {notice && <p className="m-0 rounded-md bg-brass-soft px-3 py-2 text-[13px] text-brass-dark">{notice}</p>}
        </div>
      )}
    </li>
  );
}
