import { createAdminClient } from "@/lib/supabase/admin";
import { healthHeadline, type HealthCheck } from "@/lib/alerts";
import { Badge, Notice, PageHeader, Panel, formatDate } from "../../../_ui/ui";
import AlertsForm from "./alerts-form";

export const dynamic = "force-dynamic";

// System health (workflow 33 runs the checks every 15 minutes) and where
// alerts go. Platform admins only -- the (platform) layout checks that.
export default async function AlertsPage() {
  const admin = createAdminClient();
  const [{ data: settings, error: settingsError }, { data: status, error: statusError }] = await Promise.all([
    admin
      .from("platform_alert_settings")
      .select(
        "email_enabled, email_to, whatsapp_enabled, whatsapp_to, whatsapp_sender_id, daily_summary_enabled, repeat_hours, last_email_status, last_email_at, last_whatsapp_status, last_whatsapp_at"
      )
      .eq("id", true)
      .maybeSingle(),
    admin.rpc("health_status"),
  ]);

  const checks: HealthCheck[] = (status as any)?.checks ?? [];
  const headline = healthHeadline((status as any)?.status, checks);
  const when = (iso: string | null | undefined) =>
    iso ? formatDate(iso, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" }) : "";

  return (
    <div className="grid max-w-3xl gap-6">
      <PageHeader
        title="System health and alerts"
        description="Elliot checks Claude, Gmail, Calendar, WhatsApp, the database and knowledge search every 15 minutes, and tells you when something breaks."
      />

      {(settingsError || statusError) && (
        <Notice tone="alert">
          Couldn&apos;t load: {settingsError?.message || statusError?.message}. Has migration 0036 been run in Supabase?
        </Notice>
      )}

      <Panel title="Status" action={<Badge tone={headline.tone === "ok" ? "ink" : headline.tone === "bad" ? "alert" : "neutral"}>{headline.tone === "ok" ? "Healthy" : headline.tone === "bad" ? "Needs attention" : "Not running yet"}</Badge>}>
        <p className="m-0 mb-3 text-[13.5px] text-ink">{headline.text}</p>
        {checks.length > 0 && (
          <ul className="m-0 grid list-none gap-2 p-0">
            {checks.map((c) => (
              <li key={c.key} className="flex items-start justify-between gap-3 border-b border-gray-100 pb-2 text-[13px] last:border-0 last:pb-0">
                <div>
                  <div className="font-medium text-ink">{c.label}</div>
                  {!c.ok && (
                    <div className="text-alert">
                      {c.detail}
                      {c.failing_since && <span className="text-gray-500"> · since {when(c.failing_since)}</span>}
                    </div>
                  )}
                </div>
                <Badge tone={c.ok ? "muted" : "alert"}>{c.ok ? "OK" : "Failing"}</Badge>
              </li>
            ))}
          </ul>
        )}
        {(status as any)?.checked_at && (
          <p className="m-0 mt-3 text-[12px] text-gray-500">Last checked {when((status as any).checked_at)}</p>
        )}
      </Panel>

      {settings && (
        <Panel title="Where your alerts go">
          <AlertsForm
            settings={settings}
            lastEmail={settings.last_email_status ? `${settings.last_email_status} (${when(settings.last_email_at)})` : null}
            lastWhatsapp={settings.last_whatsapp_status ? `${settings.last_whatsapp_status} (${when(settings.last_whatsapp_at)})` : null}
          />
        </Panel>
      )}

      <Panel title="Agencies">
        <p className="m-0 text-[13px] text-gray-600">
          Each agency can also get alerts about its own account (a reply that couldn&apos;t be sent, a booking that
          failed) by email and/or WhatsApp. They switch these on under Settings → Problem alerts. You always get every
          alert here as well.
        </p>
      </Panel>
    </div>
  );
}
