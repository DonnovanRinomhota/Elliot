"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorText, btn } from "../../../_ui/ui";
import { checkAlertChannels, formatWhatsapp } from "@/lib/alerts";

type Settings = {
  email_enabled: boolean;
  email_to: string | null;
  whatsapp_enabled: boolean;
  whatsapp_to: string | null;
  whatsapp_sender_id: string | null;
  daily_summary_enabled: boolean;
  repeat_hours: number;
};

export default function AlertsForm({
  settings,
  lastEmail,
  lastWhatsapp,
}: {
  settings: Settings;
  lastEmail: string | null;
  lastWhatsapp: string | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    email_enabled: settings.email_enabled,
    email: settings.email_to ?? "",
    whatsapp_enabled: settings.whatsapp_enabled,
    whatsapp: formatWhatsapp(settings.whatsapp_to),
    whatsapp_sender_id: settings.whatsapp_sender_id ?? "",
    daily_summary_enabled: settings.daily_summary_enabled,
    repeat_hours: String(settings.repeat_hours ?? 6),
  });
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const set = (patch: Partial<typeof form>) => {
    setMessage(null);
    setForm((f) => ({ ...f, ...patch }));
  };

  async function save(): Promise<boolean> {
    setError(null);
    setMessage(null);
    const checked = checkAlertChannels(form);
    if (!checked.ok) {
      setError(checked.error);
      return false;
    }
    if (form.whatsapp_enabled && !/^\d{6,}$/.test(form.whatsapp_sender_id.trim())) {
      setError("WhatsApp alerts need the phone number ID they are sent from (Meta → WhatsApp → API Setup).");
      return false;
    }
    setBusy("save");
    const res = await fetch("/api/platform/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json().catch(() => null);
    setBusy(null);
    if (!res.ok || !data?.success) {
      setError(data?.error || `Save failed (${res.status})`);
      return false;
    }
    setForm((f) => ({ ...f, whatsapp: formatWhatsapp(checked.value.whatsapp) }));
    setMessage("Saved.");
    router.refresh();
    return true;
  }

  async function sendTest() {
    if (!(await save())) return;
    setBusy("test");
    const res = await fetch("/api/platform/alerts/test", { method: "POST" });
    const data = await res.json().catch(() => null);
    setBusy(null);
    if (!res.ok || !data?.success) {
      setError(data?.error || `Test failed (${res.status})`);
      return;
    }
    setMessage("Test alert sent. It should arrive within a minute; how it went shows below after you refresh.");
    setTimeout(() => router.refresh(), 8000);
  }

  const label = "mb-1 block text-[12.5px] font-medium text-gray-600";
  const box = "rounded-lg border border-gray-100 p-3";
  return (
    <div className="grid gap-4">
      <div className={box}>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={form.email_enabled} onChange={(e) => set({ email_enabled: e.target.checked })} />
          Email alerts
        </label>
        <input
          type="email"
          className="mt-2 h-9 w-full px-3"
          value={form.email}
          onChange={(e) => set({ email: e.target.value })}
          placeholder="you@example.com"
          aria-label="Alert email address"
        />
        <p className="m-0 mt-1 text-[12.5px] text-gray-400">
          Sent from alerts@getelliot.eu through Resend, so it still arrives when Gmail is what broke. Falls back to Gmail
          if Resend isn&apos;t set up.
        </p>
        {lastEmail && <p className="m-0 mt-1 text-[12.5px] text-gray-500">Last email alert: {lastEmail}</p>}
      </div>

      <div className={box}>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={form.whatsapp_enabled} onChange={(e) => set({ whatsapp_enabled: e.target.checked })} />
          WhatsApp alerts
        </label>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="a-wa-to">Your WhatsApp number</label>
            <input id="a-wa-to" type="tel" className="h-9 w-full px-3" value={form.whatsapp} onChange={(e) => set({ whatsapp: e.target.value })} placeholder="+48 600 100 200" />
          </div>
          <div>
            <label className={label} htmlFor="a-wa-from">Send from (phone number ID)</label>
            <input
              id="a-wa-from"
              inputMode="numeric"
              className="h-9 w-full px-3"
              value={form.whatsapp_sender_id}
              onChange={(e) => set({ whatsapp_sender_id: e.target.value })}
              placeholder="e.g. 1328644853675927"
            />
          </div>
        </div>
        <p className="m-0 mt-1 text-[12.5px] text-gray-400">
          Uses the approved &quot;elliot_alert&quot; message template, so alerts arrive even if you haven&apos;t messaged
          the number lately. Agencies&apos; WhatsApp alerts are sent from this number too.
        </p>
        {lastWhatsapp && <p className="m-0 mt-1 text-[12.5px] text-gray-500">Last WhatsApp alert: {lastWhatsapp}</p>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={form.daily_summary_enabled} onChange={(e) => set({ daily_summary_enabled: e.target.checked })} />
          Daily &quot;all OK&quot; email at 8:00
        </label>
        <div>
          <label className={label} htmlFor="a-repeat">Remind me while something is still broken, every</label>
          <select id="a-repeat" className="h-9 w-full px-3" value={form.repeat_hours} onChange={(e) => set({ repeat_hours: e.target.value })}>
            {["1", "3", "6", "12", "24"].map((h) => (
              <option key={h} value={h}>
                {h} {h === "1" ? "hour" : "hours"}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <ErrorText>{error}</ErrorText>}
      {message && <p className="m-0 text-[13px] text-ink">{message}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn.primary} onClick={save} disabled={busy !== null}>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button type="button" className={btn.secondary} onClick={sendTest} disabled={busy !== null}>
          {busy === "test" ? "Sending…" : "Save and send a test alert"}
        </button>
      </div>
    </div>
  );
}
