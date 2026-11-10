"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { checkAlertChannels, formatWhatsapp } from "@/lib/alerts";
import { forwardingCode, forwardingStatus, inboundAddress, isEmail, senderPreview } from "@/lib/agency-email";

type Tenant = {
  id: string;
  name: string;
  slug: string;
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
  alert_email_enabled?: boolean | null;
  alert_email?: string | null;
  alert_whatsapp_enabled?: boolean | null;
  alert_whatsapp_number?: string | null;
  reminders_enabled?: boolean | null;
  booking_notice_minutes?: number | null;
  booking_buffer_minutes?: number | null;
  email_from_name?: string | null;
  email_inbound_last_at?: string | null;
  email_inbound_last_from?: string | null;
  email_forwarding_code?: string | null;
  email_forwarding_url?: string | null;
  email_forwarding_code_at?: string | null;
  calendar_status?: string | null;
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
  ownFromAddress = null,
}: {
  tenant: Tenant;
  aiConfig: AiConfig;
  configError: string | null;
  ownFromAddress?: string | null;
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
  const [email, setEmail] = useState({
    agency_email: aiConfig?.connected_gmail_address ?? "",
    from_name: aiConfig?.email_from_name ?? "",
  });
  const [copied, setCopied] = useState(false);
  const [integrations, setIntegrations] = useState({
    google_calendar_id: aiConfig?.google_calendar_id ?? "primary",
    crm_webhook_url: aiConfig?.crm_webhook_url ?? "",
    whatsapp_phone_number_id: aiConfig?.whatsapp_phone_number_id ?? "",
  });
  const [notifyEmail, setNotifyEmail] = useState(aiConfig?.escalation_notify_email ?? "");
  const [viewings, setViewings] = useState({
    reminders_enabled: aiConfig?.reminders_enabled ?? true,
    booking_notice_minutes: String(aiConfig?.booking_notice_minutes ?? 120),
    booking_buffer_minutes: String(aiConfig?.booking_buffer_minutes ?? 30),
  });
  const [alerts, setAlerts] = useState({
    email_enabled: !!aiConfig?.alert_email_enabled,
    email: aiConfig?.alert_email ?? "",
    whatsapp_enabled: !!aiConfig?.alert_whatsapp_enabled,
    whatsapp: formatWhatsapp(aiConfig?.alert_whatsapp_number),
  });

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
        google_calendar_id: integrations.google_calendar_id || "primary",
        crm_webhook_url: integrations.crm_webhook_url || null,
        whatsapp_phone_number_id: integrations.whatsapp_phone_number_id || null,
      })
      .eq("tenant_id", tenant.id);
    setSaving(null);
    if (error) return setErrors((e) => ({ ...e, integrations: error.message }));
    setSaved("integrations");
  }

  async function saveEmail() {
    setErrors((e) => ({ ...e, email: "" }));
    const agencyEmail = email.agency_email.trim().toLowerCase();
    if (agencyEmail && !isEmail(agencyEmail)) {
      return setErrors((e) => ({ ...e, email: "That doesn't look like an email address." }));
    }
    setSaving("email");
    const { error } = await supabase
      .from("ai_config")
      .update({ connected_gmail_address: agencyEmail || null, email_from_name: email.from_name.trim() || null })
      .eq("tenant_id", tenant.id);
    setSaving(null);
    if (error) return setErrors((e) => ({ ...e, email: error.message }));
    setEmail({ agency_email: agencyEmail, from_name: email.from_name.trim() });
    setSaved("email");
  }

  async function copyInbound() {
    try {
      await navigator.clipboard.writeText(inboundAddress(tenant.slug));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the address is on screen to copy by hand */
    }
  }

  async function saveNotifications() {
    setSaving("notifications");
    setErrors((e) => ({ ...e, notifications: "" }));
    const { error } = await supabase.from("ai_config").update({ escalation_notify_email: notifyEmail || null }).eq("tenant_id", tenant.id);
    setSaving(null);
    if (error) return setErrors((e) => ({ ...e, notifications: error.message }));
    setSaved("notifications");
  }

  async function saveViewings() {
    setSaving("viewings");
    setErrors((e) => ({ ...e, viewings: "" }));
    const { error } = await supabase
      .from("ai_config")
      .update({
        reminders_enabled: viewings.reminders_enabled,
        booking_notice_minutes: Number(viewings.booking_notice_minutes),
        booking_buffer_minutes: Number(viewings.booking_buffer_minutes),
      })
      .eq("tenant_id", tenant.id);
    setSaving(null);
    if (error) return setErrors((e) => ({ ...e, viewings: error.message }));
    setSaved("viewings");
  }

  async function saveAlerts() {
    setErrors((e) => ({ ...e, alerts: "" }));
    const checked = checkAlertChannels(alerts);
    if (!checked.ok) return setErrors((e) => ({ ...e, alerts: checked.error }));
    setSaving("alerts");
    const v = checked.value;
    const { error } = await supabase
      .from("ai_config")
      .update({
        alert_email_enabled: v.email_enabled,
        alert_email: v.email,
        alert_whatsapp_enabled: v.whatsapp_enabled,
        alert_whatsapp_number: v.whatsapp,
      })
      .eq("tenant_id", tenant.id);
    setSaving(null);
    if (error) return setErrors((e) => ({ ...e, alerts: error.message }));
    setAlerts((a) => ({ ...a, whatsapp: formatWhatsapp(v.whatsapp) }));
    setSaved("alerts");
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

      <Card title="Email" description="Elliot answers the emails clients send you, and sends confirmations and reminders in your name.">
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="s-agency-email">Your agency&apos;s email address</label>
            <input
              id="s-agency-email"
              className={inputClass}
              type="email"
              value={email.agency_email}
              onChange={(e) => { setSaved(null); setEmail({ ...email, agency_email: e.target.value }); }}
              placeholder="biuro@youragency.pl"
            />
            <p className="mt-1 text-[12.5px] text-gray-400">Where clients write to you. Their replies to Elliot&apos;s emails come back here.</p>
          </div>
          <div>
            <label className={labelClass} htmlFor="s-from-name">Sender name</label>
            <input
              id="s-from-name"
              className={inputClass}
              value={email.from_name}
              onChange={(e) => { setSaved(null); setEmail({ ...email, from_name: e.target.value }); }}
              placeholder={tenant.name}
            />
            <p className="mt-1 text-[12.5px] text-gray-400">The name clients see. Empty uses your business name.</p>
          </div>
        </div>
        {(() => {
          const p = senderPreview({ slug: tenant.slug, agencyName: tenant.name, fromName: email.from_name, ownFromAddress, agencyEmail: email.agency_email });
          return (
            <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-gray-50 px-3 py-2.5 text-[12.5px]">
              <dt className="text-gray-500">Clients get emails from</dt>
              <dd className="m-0 break-all font-medium text-gray-700">{p.from}</dd>
              <dt className="text-gray-500">Their replies go to</dt>
              <dd className="m-0 break-all font-medium text-gray-700">{p.replyTo}</dd>
            </dl>
          );
        })()}
        {errors.email && <p className="mb-2 text-[12.5px] text-alert">{errors.email}</p>}
        <SaveButton saving={saving === "email"} saved={saved === "email"} onClick={saveEmail} />

        <div className="mt-5 border-t border-gray-100 pt-4">
          <h3 className="m-0 text-sm font-semibold text-ink">Forward your inbox to Elliot</h3>
          <p className="m-0 mt-0.5 mb-3 text-[13px] text-gray-500">
            Set your inbox to forward a copy of incoming email to this address. You keep every email; Elliot answers the enquiries and skips newsletters and automatic emails.
          </p>
          <div className="mb-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-ink">{inboundAddress(tenant.slug)}</code>
            <button
              type="button"
              onClick={copyInbound}
              className="h-9 shrink-0 cursor-pointer rounded-full border border-gray-200 bg-white px-3.5 text-[13px] font-medium text-ink hover:bg-gray-50"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {(() => {
            const st = forwardingStatus(aiConfig?.email_inbound_last_at, aiConfig?.email_inbound_last_from);
            const dot = st.tone === "ok" ? "bg-accent" : st.tone === "quiet" ? "bg-alert" : "bg-gray-300";
            return (
              <p className="mb-3 flex items-start gap-2 text-[12.5px] text-gray-600">
                <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
                {st.label}
              </p>
            );
          })()}
          {forwardingCode(aiConfig?.email_forwarding_code, aiConfig?.email_forwarding_code_at) && (
            <div className="mb-3 rounded-lg bg-accent-soft px-3 py-2.5 text-[13px] text-ink">
              Gmail&apos;s confirmation code: <strong className="font-mono tracking-wide">{aiConfig?.email_forwarding_code}</strong>
              <span className="block text-[12.5px] text-gray-600">
                Enter it in Gmail where you added the forwarding address
                {aiConfig?.email_forwarding_url ? (
                  <>
                    , or{" "}
                    <a className="text-accent-dark underline" href={aiConfig.email_forwarding_url} target="_blank" rel="noreferrer">
                      confirm with Google&apos;s link
                    </a>
                  </>
                ) : null}
                .
              </span>
            </div>
          )}
          <details className="text-[13px] text-gray-600">
            <summary className="cursor-pointer font-medium text-ink">How to set up forwarding</summary>
            <div className="mt-2 flex flex-col gap-3">
              <div>
                <strong className="text-gray-700">Gmail or Google Workspace</strong>
                <ol className="m-0 mt-1 list-decimal pl-5">
                  <li>Settings (gear) → See all settings → Forwarding and POP/IMAP → Add a forwarding address.</li>
                  <li>Paste the address above → Next → Proceed.</li>
                  <li>Google sends a confirmation code to Elliot. Refresh this page after a minute: the code appears above. Enter it in Gmail and click Verify.</li>
                  <li>Choose &ldquo;Forward a copy of incoming mail to&rdquo; the address above, and &ldquo;keep Gmail&apos;s copy in the Inbox&rdquo;. Save Changes.</li>
                </ol>
              </div>
              <div>
                <strong className="text-gray-700">Outlook or Microsoft 365</strong>
                <ol className="m-0 mt-1 list-decimal pl-5">
                  <li>Settings → Mail → Forwarding → Enable forwarding.</li>
                  <li>Paste the address above, tick &ldquo;Keep a copy of forwarded messages&rdquo;, Save.</li>
                  <li>On a company Microsoft 365 account, your IT administrator may need to allow forwarding to outside addresses.</li>
                </ol>
              </div>
              <div>
                <strong className="text-gray-700">Other email (home.pl, OVH, nazwa.pl, cPanel…)</strong>
                <p className="m-0 mt-1">In your email hosting panel, add a forward (przekierowanie) from your address to the address above, keeping a copy in your mailbox.</p>
              </div>
              <p className="m-0 text-[12.5px] text-gray-500">
                Then send a test email from another address to yours: Elliot answers within a minute, and the status above turns to Working.
              </p>
            </div>
          </details>
        </div>
      </Card>

      <Card title="Connected services" description="Your calendar, CRM and WhatsApp number.">
        {configError && <p className="mb-3 text-[12.5px] text-alert">Couldn&apos;t load your current settings: {configError}</p>}
        <div className="mb-3">
          <label className={labelClass}>Agency Google Calendar ID</label>
          <input
            className={inputClass}
            value={integrations.google_calendar_id}
            onChange={(e) => setIntegrations({ ...integrations, google_calendar_id: e.target.value })}
          />
          <p className="mt-1 text-[12.5px] text-gray-400">
            Used when no agent has their own calendar. Agents add theirs on the{" "}
            <a href="/dashboard/team" className="text-gray-500 underline">Team page</a>, so two of them can have viewings at the same time.
            {aiConfig?.calendar_status === "not_shared" && <span className="block text-alert">Elliot can&apos;t see this calendar: share it with Elliot&apos;s Google account.</span>}
          </p>
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
      <Card title="Viewings" description="When clients can book, and the reminder they get the day before.">
        <label className="mb-4 flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={viewings.reminders_enabled}
            onChange={(e) => { setSaved(null); setViewings({ ...viewings, reminders_enabled: e.target.checked }); }}
          />
          <span>
            Remind clients the day before
            <span className="block text-[12.5px] text-gray-500">
              At 17:00, on WhatsApp if that&apos;s where they wrote, otherwise by email. They can reply to confirm, move or
              cancel, and Elliot handles it and tells the agent.
            </span>
          </span>
        </label>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="s-notice">Earliest booking</label>
            <select
              id="s-notice"
              className={inputClass}
              value={viewings.booking_notice_minutes}
              onChange={(e) => { setSaved(null); setViewings({ ...viewings, booking_notice_minutes: e.target.value }); }}
            >
              {[["0", "Any time"], ["60", "1 hour from now"], ["120", "2 hours from now"], ["240", "4 hours from now"], ["720", "12 hours from now"], ["1440", "Next day"]].map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="s-buffer">Gap between viewings</label>
            <select
              id="s-buffer"
              className={inputClass}
              value={viewings.booking_buffer_minutes}
              onChange={(e) => { setSaved(null); setViewings({ ...viewings, booking_buffer_minutes: e.target.value }); }}
            >
              {[["0", "None"], ["15", "15 minutes"], ["30", "30 minutes"], ["45", "45 minutes"], ["60", "1 hour"]].map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="-mt-2 mb-4 text-[12.5px] text-gray-400">The gap is kept free before and after everything in the calendar, for travel between properties.</p>
        {errors.viewings && <p className="mb-2 text-[12.5px] text-alert">{errors.viewings}</p>}
        <SaveButton saving={saving === "viewings"} saved={saved === "viewings"} onClick={saveViewings} />
      </Card>

      <Card
        title="Problem alerts"
        description="Get told when something goes wrong with your clients' messages, so nobody is left waiting."
      >
        <p className="m-0 mb-4 text-[13px] text-gray-600">
          For example: a reply to a client couldn&apos;t be sent, Elliot couldn&apos;t answer a message, or a viewing
          couldn&apos;t be booked. Checked regularly. Your Elliot administrator is always told as well.
        </p>
        <div className="mb-4 rounded-lg border border-gray-100 p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={alerts.email_enabled}
              onChange={(e) => { setSaved(null); setAlerts({ ...alerts, email_enabled: e.target.checked }); }}
            />
            Email alerts
          </label>
          <input
            className={`${inputClass} mt-2`}
            type="email"
            value={alerts.email}
            onChange={(e) => { setSaved(null); setAlerts({ ...alerts, email: e.target.value }); }}
            placeholder="owner@yourbusiness.com"
            aria-label="Alert email address"
          />
        </div>
        <div className="mb-4 rounded-lg border border-gray-100 p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={alerts.whatsapp_enabled}
              onChange={(e) => { setSaved(null); setAlerts({ ...alerts, whatsapp_enabled: e.target.checked }); }}
            />
            WhatsApp alerts
          </label>
          <input
            className={`${inputClass} mt-2`}
            type="tel"
            value={alerts.whatsapp}
            onChange={(e) => { setSaved(null); setAlerts({ ...alerts, whatsapp: e.target.value }); }}
            placeholder="+48 600 100 200"
            aria-label="Alert WhatsApp number"
          />
          <p className="mt-1 text-[12.5px] text-gray-400">With the country code. A short one-line message; the details are in your dashboard.</p>
        </div>
        {errors.alerts && <p className="mb-2 text-[12.5px] text-alert">{errors.alerts}</p>}
        <SaveButton saving={saving === "alerts"} saved={saved === "alerts"} onClick={saveAlerts} />
      </Card>
    </div>
  );
}
