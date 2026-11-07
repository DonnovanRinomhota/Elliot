"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { btn } from "../../../_ui/ui";

// Cancel (upcoming) or Completed / No-show (past) for one appointment. Used in
// the Appointments list and on an appointment's own page.
export default function AppointmentActions({
  id,
  status,
  startsAt,
  align = "end",
}: {
  id: string;
  status: string;
  startsAt: string;
  align?: "start" | "end";
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isPast = new Date(startsAt).getTime() <= Date.now();
  const isFinal = ["cancelled", "completed", "no_show"].includes(status);

  // Cancelling goes through the server (workflow 30) so the Google Calendar
  // event is removed too -- see app/api/appointments/[id]/cancel/route.ts.
  async function cancel() {
    if (!window.confirm("Cancel this appointment? It will also be removed from the calendar.")) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    let data: { success: boolean; error?: string; calendar?: string } | null = null;
    try {
      const res = await fetch(`/api/appointments/${id}/cancel`, { method: "POST" });
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

  async function setStatus(next: string) {
    setBusy(true);
    setError(null);
    const { error: updateError } = await supabase.from("appointments").update({ status: next }).eq("id", id);
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.refresh();
  }

  if (isFinal && !error && !notice) return null;

  return (
    <div className={`grid gap-2 ${align === "end" ? "md:justify-items-end" : ""}`}>
      {!isFinal && (
        <div className={`flex flex-wrap gap-2 ${align === "end" ? "md:justify-end" : ""}`}>
          {!isPast && (
            <button type="button" onClick={cancel} disabled={busy} className={`${btn.danger} ${btn.small}`}>
              Cancel
            </button>
          )}
          {isPast && (
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
      )}
      {error && (
        <p className="m-0 text-[13px] text-alert" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="m-0 rounded-md bg-brass-soft px-3 py-2 text-[13px] text-brass-dark">{notice}</p>}
    </div>
  );
}
