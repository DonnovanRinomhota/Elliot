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
};

type AiConfig = {
  tenant_id: string;
  autonomy_rules: Record<string, { mode?: string }> | null;
  connected_gmail_address: string | null;
  google_calendar_id: string | null;
  crm_webhook_url: string | null;
  escalation_notify_email: string | null;
} | null;

// Matches the actions this codebase actually checks a mode for (main agent's
// tool routing, the follow-up sweep). Not every possible tool -- only the
// ones something downstream really reads autonomy_rules for.
const AUTONOMY_ACTIONS: { key: string; label: string; description: string }[] = [
  { key: "send_email", label: "Send email replies", description: "High-confidence FAQ answers only ever qualify, regardless of this setting -- see workflow 14's spec." },
  { key: "book_appointment", label: "Book appointments", description: "Confirming a specific time slot a visitor has already agreed to." },
  { key: "send_follow_up", label: "Send follow-up sequences", description: "Each scheduled step in an active follow-up sequence." },
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
      className="rounded-md bg-ink px-4 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
    >
      {saving ? "Saving…" : saved ? "Saved ✓" : "Save changes"}
    </button>
  );
}

function Card({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-gray-500">{description}</div>
      </div>
      {children}
    </div>
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

  const [profile, setProfile] = useState({ name: tenant.name, industry: tenant.industry ?? "", timezone: tenant.timezone });
  const [autonomy, setAutonomy] = useState<Record<string, string>>(
    Object.fromEntries(AUTONOMY_ACTIONS.map((a) => [a.key, aiConfig?.autonomy_rules?.[a.key]?.mode ?? "approval_required"]))
  );
  const [integrations, setIntegrations] = useState({
    connected_gmail_address: aiConfig?.connected_gmail_address ?? "",
    google_calendar_id: aiConfig?.google_calendar_id ?? "primary",
    crm_webhook_url: aiConfig?.crm_webhook_url ?? "",
  });
  const [notifyEmail, setNotifyEmail] = useState(aiConfig?.escalation_notify_email ?? "");

  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function saveProfile() {
    setSaving("profile");
    setErrors((e) => ({ ...e, profile: "" }));
    const { error } = await supabase
      .from("tenants")
      .update({ name: profile.name, industry: profile.industry || null, timezone: profile.timezone })
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

  const inputClass = "w-full rounded-md border border-gray-200 px-3 py-2 text-sm";
  const labelClass = "mb-1 block text-xs font-medium text-gray-600";

  return (
    <div className="max-w-2xl">
      <Card title="Business Profile" description="Your business details, used across the agent's prompts and reports.">
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Business name</label>
            <input className={inputClass} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
          </div>
          <div>
            <label className={labelClass}>Industry</label>
            <input className={inputClass} value={profile.industry} onChange={(e) => setProfile({ ...profile, industry: e.target.value })} placeholder="e.g. real_estate" />
          </div>
        </div>
        <div className="mb-3">
          <label className={labelClass}>Timezone</label>
          <input className={inputClass} value={profile.timezone} onChange={(e) => setProfile({ ...profile, timezone: e.target.value })} placeholder="e.g. Europe/Warsaw" />
        </div>
        <div className="mb-4 flex gap-4 text-xs text-gray-500">
          <span>
            Plan: <strong className="text-gray-700">{PLAN_LABELS[tenant.plan] || tenant.plan}</strong>
          </span>
          <span>
            Status: <strong className="text-gray-700">{tenant.status}</strong>
          </span>
        </div>
        {errors.profile && <p className="mb-2 text-xs text-red-700">{errors.profile}</p>}
        <SaveButton saving={saving === "profile"} saved={saved === "profile"} onClick={saveProfile} />
      </Card>

      <Card title="Automation rules" description="What Elliot is allowed to do on its own, versus what needs your approval first.">
        <div className="mb-4 flex flex-col gap-3">
          {AUTONOMY_ACTIONS.map((action) => (
            <div key={action.key} className="flex items-start justify-between gap-4 border-b border-gray-100 pb-3 last:border-0 last:pb-0">
              <div>
                <div className="text-sm">{action.label}</div>
                <div className="text-xs text-gray-500">{action.description}</div>
              </div>
              <select
                className="rounded-md border border-gray-200 px-2 py-1.5 text-xs"
                value={autonomy[action.key]}
                onChange={(e) => setAutonomy({ ...autonomy, [action.key]: e.target.value })}
              >
                <option value="approval_required">Needs approval</option>
                <option value="autonomous">Fully automatic</option>
              </select>
            </div>
          ))}
        </div>
        {errors.autonomy && <p className="mb-2 text-xs text-red-700">{errors.autonomy}</p>}
        <SaveButton saving={saving === "autonomy"} saved={saved === "autonomy"} onClick={saveAutonomy} />
      </Card>

      <Card title="Integrations" description="Connected inboxes, calendar, and CRM sync target.">
        {configError && <p className="mb-3 text-xs text-red-700">Failed to load current values: {configError}</p>}
        <div className="mb-3">
          <label className={labelClass}>Connected Gmail address</label>
          <input
            className={inputClass}
            value={integrations.connected_gmail_address}
            onChange={(e) => setIntegrations({ ...integrations, connected_gmail_address: e.target.value })}
            placeholder="inbox@yourbusiness.com"
          />
          <p className="mt-1 text-xs text-gray-400">
            This is a reference value only -- the actual Gmail connection is still a manual OAuth setup in n8n (see docs/workflow-specs/19-tenant-onboarding.md).
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
          <p className="mt-1 text-xs text-gray-400">Where CRM sync sends lead/contact/appointment updates. Leave blank to disable sync.</p>
        </div>
        {errors.integrations && <p className="mb-2 text-xs text-red-700">{errors.integrations}</p>}
        <SaveButton saving={saving === "integrations"} saved={saved === "integrations"} onClick={saveIntegrations} />
      </Card>

      <Card title="Notifications" description="Where to send an alert when a conversation is escalated to a human.">
        <div className="mb-4">
          <label className={labelClass}>Escalation alert email</label>
          <input className={inputClass} value={notifyEmail} onChange={(e) => setNotifyEmail(e.target.value)} placeholder="team@yourbusiness.com" />
          <p className="mt-1 text-xs text-gray-400">Leave blank to disable email alerts -- escalations are always recorded and visible on the Escalations page either way.</p>
        </div>
        {errors.notifications && <p className="mb-2 text-xs text-red-700">{errors.notifications}</p>}
        <SaveButton saving={saving === "notifications"} saved={saved === "notifications"} onClick={saveNotifications} />
      </Card>
    </div>
  );
}
