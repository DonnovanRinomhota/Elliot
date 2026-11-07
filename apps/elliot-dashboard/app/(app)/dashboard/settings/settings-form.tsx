"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Tenant = {
  id: string;
  name: string;
  industry: string | null;
  plan: string;
  status: string;
  timezone: string;
  avg_deal_value: number | null;
};

type AiConfig = {
  tenant_id: string;
  autonomy_rules: Record<string, { mode?: string }> | null;
  connected_gmail_address: string | null;
  google_calendar_id: string | null;
  crm_webhook_url: string | null;
  escalation_notify_email: string | null;
  whatsapp_phone_number_id: string | null;
} | null;

// Matches the actions this codebase actually checks a mode for (main agent's
// tool routing, the follow-up sweep). Not every possible tool -- only the
// ones something downstream really reads autonomy_rules for.
const AUTONOMY_ACTIONS: { key: string; label: string; description: string }[] = [
  { key: "send_email", label: "Send email replies", description: "Even when automatic, only confident answers to common questions are sent without review." },
  { key: "book_appointment", label: "Book appointments", description: "Confirming a viewing time the client has already agreed to." },
  { key: "send_follow_up", label: "Send follow-up sequences", description: "Each scheduled email in an active follow-up sequence." },
];

const PLAN_LABELS: Record<string, string> = {
  trial: "Trial",
  starter: "Starter",
  pro: "Pro",
  enterprise: "Enterprise",
};

function SaveButton({ saving, saved, onClick }: { saving: boolean; saved: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className="inline-flex h-9 cursor-pointer items-center justify-center rounded-full border-0 bg-ink px-3.5 text-[13px] font-medium text-white hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
    </button>
  );
}

function Card({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 card">
      <header className="border-b border-gray-100 px-5 py-4">
        <h2 className="m-0 text-[15px] font-semibold text-ink">{title}</h2>
        <p className="m-0 mt-0.5 text-[13px] text-gray-500">{description}</p>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export default function SettingsForm({
  tenant,
  aiConfig,
  configError,
}: {
  tenant: Tenant;
  aiConfig: AiConfig;
  configError: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [profile, setProfile] = useState({
    name: tenant.name,
    industry: tenant.industry ?? "",
    timezone: tenant.timezone,
    avg_deal_value: tenant.avg_deal_value != null ? String(tenant.avg_deal_value) : "",
  });
  const [autonomy, setAutonomy] = useState<Record<string, string>>(
    Object.fromEntries(AUTONOMY_ACTIONS.map((a) => [a.key, aiConfig?.autonomy_rules?.[a.key]?.mode ?? "approval_required"]))
  );
  const [integrations, setIntegrations] = useState({
    connected_gmail_address: aiConfig?.connected_gmail_address ?? "",
    google_calendar_id: aiConfig?.google_calendar_id ?? "primary",
    crm_webhook_url: aiConfig?.crm_webhook_url ?? "",
    whatsapp_phone_number_id: aiConfig?.whatsapp_phone_number_id ?? "",
  });
  const [notifyEmail, setNotifyEmail] = useState(aiConfig?.escalation_notify_email ?? "");

  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function saveProfile() {
    setSaving("profile");
    setErrors((e) => ({ ...e, profile: "" }));

    let avgDealValue: number | null = null;
    if (profile.avg_deal_value.trim() !== "") {
      const parsed = Number(profile.avg_deal_value);
      if (Number.isNaN(parsed) || parsed < 0) {
        setSaving(null);
        return setErrors((e) => ({ ...e, profile: "Average deal value must be a positive number, or left blank." }));
      }
      avgDealValue = parsed;
    }

    const { error } = await supabase
      .from("tenants")
      .update({ name: profile.name, industry: profile.industry || null, timezone: profile.timezone, avg_deal_value: avgDealValue })
      .eq("id", tenant.id);
    setSaving(null);
    if (error) return setErrors((e) => ({ ...e, profile: error.message }));
    setSaved("profile");
    router.refresh();
  }

  async function saveAutonomy() {
    setSaving("autonomy");
    setErrors((e) => ({ ...e, autonomy: "" }));
    const newRules = Object.fromEntries(AUTONOMY_ACTIONS.map((a) => [a.key, { mode: autonomy[a.key] }]));
    const { error } = await supabase.from("ai_config").update({ autonomy_rules: newRules }).eq("tenant_id", tenant.id);
    setSaving(null);
    if (error) return setErrors((e) => ({ ...e, autonomy: error.message }));
    setSaved("autonomy");
  }

  async function saveIntegrations() {
    setSaving("integrations");
    setErrors((e) => ({ ...e, integrations: "" }));
    const { error } = await supabase
      .from("ai_config")
      .update({
        connected_gmail_address: integrations.connected_gmail_address || null,
        google_calendar_id: integrations.google_calendar_id || "primary",
        crm_webhook_url: integrations.crm_webhook_url || null,
        whatsapp_phone_number_id: integrations.whatsapp_phone_number_id || null,
      })
      .eq("tenant_id", tenant.id);
    setSaving(null);
    if (error) return setErrors((e) => ({ ...e, integrations: error.message }));
    setSaved("integrations");
  }

  async function saveNotifications() {
    setSaving("notifications");
    setErrors((e) => ({ ...e, notifications: "" }));
    const { error } = await supabase.from("ai_config").update({ escalation_notify_email: notifyEmail || null }).eq("tenant_id", tenant.id);
    setSaving(null);
    if (error) return setErrors((e) => ({ ...e, notifications: error.message }));
    setSaved("notifications");
  }

  const inputClass = "h-9 w-full px-3";
  const labelClass = "mb-1 block text-[12.5px] font-medium text-gray-700";

  return (
    <div className="max-w-2xl">
      <Card title="Business profile" description="Used in Elliot's replies and in your reports.">
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Business name</label>
            <input className={inputClass} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
          </div>
          <div>
            <label className={labelClass}>Industry</label>
            <input className={inputClass} value={profile.industry} onChange={(e) => setProfile({ ...profile, industry: e.target.value })} placeholder="e.g. Real estate" />
          </div>
        </div>
        <div className="mb-3">
          <label className={labelClass}>Timezone</label>
          <input className={inputClass} value={profile.timezone} onChange={(e) => setProfile({ ...profile, timezone: e.target.value })} placeholder="e.g. Europe/Warsaw" />
        </div>
        <div className="mb-3">
          <label className={labelClass}>Average deal value</label>
          <input
            className={inputClass}
            type="number"
            min="0"
            step="any"
            value={profile.avg_deal_value}
            onChange={(e) => setProfile({ ...profile, avg_deal_value: e.target.value })}
            placeholder="e.g. 8000"
          />
          <p className="mt-1 text-[12.5px] text-gray-400">
            Your typical commission or revenue per closed deal. Used for the estimate on the Overview page. Leave
            blank to hide the estimate.
          </p>
        </div>
        <div className="mb-4 flex gap-4 text-[12.5px] text-gray-500">
          <span>
            Plan: <strong className="text-gray-700">{PLAN_LABELS[tenant.plan] || tenant.plan}</strong>
          </span>
          <span>
            Status: <strong className="text-gray-700">{tenant.status}</strong>
          </span>
        </div>
        {errors.profile && <p className="mb-2 text-[12.5px] text-alert">{errors.profile}</p>}
        <SaveButton saving={saving === "profile"} saved={saved === "profile"} onClick={saveProfile} />
      </Card>

      <Card title="What Elliot may do on its own" description="Anything set to Needs approval waits in Approvals until you approve it.">
        <div className="mb-4 flex flex-col gap-3">
          {AUTONOMY_ACTIONS.map((action) => (
            <div key={action.key} className="flex items-start justify-between gap-4 border-b border-gray-100 pb-3 last:border-0 last:pb-0">
              <div>
                <div className="text-sm">{action.label}</div>
                <div className="text-[12.5px] text-gray-500">{action.description}</div>
              </div>
              <select
                className="h-8 px-2 text-[13px]"
                value={autonomy[action.key]}
                onChange={(e) => setAutonomy({ ...autonomy, [action.key]: e.target.value })}
              >
                <option value="approval_required">Needs approval</option>
                <option value="autonomous">Fully automatic</option>
              </select>
            </div>
          ))}
        </div>
        {errors.autonomy && <p className="mb-2 text-[12.5px] text-alert">{errors.autonomy}</p>}
        <SaveButton saving={saving === "autonomy"} saved={saved === "autonomy"} onClick={saveAutonomy} />
      </Card>

      <Card title="Connected services" description="Your inbox, calendar, CRM and WhatsApp number.">
        {configError && <p className="mb-3 text-[12.5px] text-alert">Couldn&apos;t load your current settings: {configError}</p>}
        <div className="mb-3">
          <label className={labelClass}>Connected Gmail address</label>
          <input
            className={inputClass}
            value={integrations.connected_gmail_address}
            onChange={(e) => setIntegrations({ ...integrations, connected_gmail_address: e.target.value })}
            placeholder="inbox@yourbusiness.com"
          />
          <p className="mt-1 text-[12.5px] text-gray-400">
            The inbox Elliot reads and replies from. Changing this here doesn&apos;t reconnect the inbox; contact your
            Elliot administrator to switch accounts.
          </p>
        </div>
        <div className="mb-3">
          <label className={labelClass}>Google Calendar ID</label>
          <input
            className={inputClass}
            value={integrations.google_calendar_id}
            onChange={(e) => setIntegrations({ ...integrations, google_calendar_id: e.target.value })}
          />
        </div>
        <div className="mb-4">
          <label className={labelClass}>CRM webhook URL</label>
          <input
            className={inputClass}
            value={integrations.crm_webhook_url}
            onChange={(e) => setIntegrations({ ...integrations, crm_webhook_url: e.target.value })}
            placeholder="https://..."
          />
          <p className="mt-1 text-[12.5px] text-gray-400">New and updated contacts, leads and viewings are sent here automatically. Leave blank to turn CRM sync off.</p>
        </div>
        <div className="mb-4">
          <label className={labelClass}>WhatsApp phone number ID</label>
          <input
            className={inputClass}
            value={integrations.whatsapp_phone_number_id}
            onChange={(e) => setIntegrations({ ...integrations, whatsapp_phone_number_id: e.target.value })}
            placeholder="e.g. 109876543212345"
          />
          <p className="mt-1 text-[12.5px] text-gray-400">
            Found in Meta&apos;s WhatsApp settings under API Setup. It&apos;s an ID number, not the phone number itself.
          </p>
        </div>
        {errors.integrations && <p className="mb-2 text-[12.5px] text-alert">{errors.integrations}</p>}
        <SaveButton saving={saving === "integrations"} saved={saved === "integrations"} onClick={saveIntegrations} />
      </Card>

      <Card title="Notifications" description="Who gets an email when Elliot hands a conversation to a person.">
        <div className="mb-4">
          <label className={labelClass}>Escalation alert email</label>
          <input className={inputClass} value={notifyEmail} onChange={(e) => setNotifyEmail(e.target.value)} placeholder="team@yourbusiness.com" />
          <p className="mt-1 text-[12.5px] text-gray-400">Leave blank to turn off email alerts. Escalations always appear on the Escalations page.</p>
        </div>
        {errors.notifications && <p className="mb-2 text-[12.5px] text-alert">{errors.notifications}</p>}
        <SaveButton saving={saving === "notifications"} saved={saved === "notifications"} onClick={saveNotifications} />
      </Card>
    </div>
  );
}
