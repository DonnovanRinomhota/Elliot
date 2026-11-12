"use client";

import { useState } from "react";
import { btn } from "../../../../_ui/ui";

// "Start 7-day trial" at go-live (0050). The clock starts now; when it ends,
// Elliot pauses for the agency until you change their plan.
export default function StartTrial({
  tenantId,
  running,
  endsAt,
}: {
  tenantId: string;
  running: boolean;
  endsAt: string | null;
}) {
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    const what = running ? `Restart the trial for ${days} days from now?` : `Start a ${days}-day trial now? When it ends, Elliot pauses for this agency until you change their plan.`;
    if (!window.confirm(what)) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/platform/tenants/${tenantId}/trial`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      setBusy(false);
      setError(data?.error || `Couldn't start the trial (${res.status}).`);
      return;
    }
    window.location.reload();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="trial-days" className="sr-only">Trial length</label>
      <select id="trial-days" value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-9 px-3" disabled={busy}>
        <option value={7}>7 days</option>
        <option value={14}>14 days</option>
      </select>
      <button type="button" onClick={start} disabled={busy} className={running ? btn.secondary : btn.primary}>
        {busy ? "Starting…" : running ? "Restart trial" : "Start trial"}
      </button>
      {running && endsAt && (
        <span className="text-[12.5px] text-gray-500">
          Ends {new Date(endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </span>
      )}
      {error && <span className="basis-full text-[13px] text-alert">{error}</span>}
    </div>
  );
}
