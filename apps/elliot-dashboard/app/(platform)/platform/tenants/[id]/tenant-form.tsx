"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorText, btn } from "../../../../_ui/ui";

type Tenant = {
  id: string;
  name: string;
  plan: string;
  status: string;
  trial_ends_at: string | null;
  paid_until: string | null;
  monthly_price: number | string | null;
  contact_email: string | null;
  notes: string | null;
  assistant_mode?: string | null;
};

const PLANS = [
  ["trial", "Free trial"],
  ["starter", "Starter"],
  ["pro", "Pro"],
  ["enterprise", "Enterprise"],
  ["complimentary", "Complimentary (no charge)"],
];
// 0037: what Elliot is for this account. Agencies are "agency"; the other two
// are getelliot.eu's own accounts.
const MODES = [
  ["agency", "Estate agency (normal)"],
  ["sales", "Elliot's own website assistant (getelliot.eu)"],
  ["demo", "Public demo agency (getelliot.eu/demo)"],
];
const STATUSES = [
  ["active", "Active: Elliot answers chats"],
  ["suspended", "Suspended: chat switched off"],
  ["cancelled", "Cancelled"],
];

const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

export default function TenantForm({ tenant }: { tenant: Tenant }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: tenant.name,
    plan: tenant.plan,
    status: tenant.status,
    trial_ends_at: toDateInput(tenant.trial_ends_at),
    paid_until: toDateInput(tenant.paid_until),
    monthly_price: tenant.monthly_price == null ? "" : String(tenant.monthly_price),
    contact_email: tenant.contact_email ?? "",
    notes: tenant.notes ?? "",
    assistant_mode: tenant.assistant_mode ?? "agency",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  function addMonth() {
    const base = form.paid_until && new Date(form.paid_until) > new Date() ? new Date(form.paid_until) : new Date();
    base.setMonth(base.getMonth() + 1);
    setSaved(false);
    setForm((f) => ({ ...f, paid_until: base.toISOString().slice(0, 10) }));
  }

  async function save() {
    if (form.status !== tenant.status && form.status !== "active") {
      const ok = window.confirm(
        `${form.status === "suspended" ? "Suspend" : "Cancel"} ${tenant.name}? Elliot will stop answering chats on their website straight away.`
      );
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/platform/tenants/${tenant.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok || !data?.success) {
      setError(data?.error || `Save failed (${res.status})`);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  const label = "mb-1 block text-[12.5px] font-medium text-gray-600";
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="t-name">Agency name</label>
          <input id="t-name" value={form.name} onChange={set("name")} className="h-9 w-full px-3" />
        </div>
        <div>
          <label className={label} htmlFor="t-email">Billing contact email</label>
          <input id="t-email" type="email" value={form.contact_email} onChange={set("contact_email")} className="h-9 w-full px-3" />
        </div>
        <div>
          <label className={label} htmlFor="t-plan">Plan</label>
          <select id="t-plan" value={form.plan} onChange={set("plan")} className="h-9 w-full px-3">
            {PLANS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="t-status">Status</label>
          <select id="t-status" value={form.status} onChange={set("status")} className="h-9 w-full px-3">
            {STATUSES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        {form.plan === "trial" ? (
          <div>
            <label className={label} htmlFor="t-trial">Trial ends</label>
            <input id="t-trial" type="date" value={form.trial_ends_at} onChange={set("trial_ends_at")} className="h-9 w-full px-3" />
          </div>
        ) : form.plan !== "complimentary" ? (
          <div>
            <label className={label} htmlFor="t-paid">Paid until</label>
            <div className="flex gap-2">
              <input id="t-paid" type="date" value={form.paid_until} onChange={set("paid_until")} className="h-9 min-w-0 flex-1 px-3" />
              <button type="button" onClick={addMonth} className={btn.secondary} title="Record one more month's payment">
                +1 month
              </button>
            </div>
          </div>
        ) : (
          <div />
        )}
        {form.plan !== "trial" && form.plan !== "complimentary" && (
          <div>
            <label className={label} htmlFor="t-price">Monthly price (€, net)</label>
            <input id="t-price" inputMode="decimal" value={form.monthly_price} onChange={set("monthly_price")} className="h-9 w-full px-3" />
          </div>
        )}
      </div>
      <div>
        <label className={label} htmlFor="t-mode">Account type</label>
        <select id="t-mode" value={form.assistant_mode} onChange={set("assistant_mode")} className="h-9 w-full px-3">
          {MODES.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        {form.assistant_mode !== "agency" && (
          <p className="m-0 mt-1 text-[12.5px] text-gray-500">
            {form.assistant_mode === "sales"
              ? "Answers questions about Elliot and books intro calls and demos with Google Meet. Only one account should be this."
              : "Sample agency for the live demo. Visitors' chats and bookings are deleted after 3 days. Only one account should be this."}
          </p>
        )}
      </div>
      <div>
        <label className={label} htmlFor="t-notes">Private notes</label>
        <textarea id="t-notes" rows={3} value={form.notes} onChange={set("notes")} className="w-full p-3" placeholder="Only you see these." />
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={busy} className={btn.primary}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        {saved && <span className="text-[13px] text-gray-500">Saved.</span>}
      </div>
    </div>
  );
}
