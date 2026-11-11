import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminView, getCurrentTenantId, getMembership } from "@/lib/tenant";
import { PageHeader } from "../../../_ui/ui";
import SettingsForm from "./settings-form";
import SupportAccessCard from "./support-access-card";
import AsariCard from "./asari-card";
import type { AsariStatus } from "@/lib/asari";

export default async function SettingsPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // current_tenant_id(): the user's agency, or the one a platform admin is viewing.
  const currentTenantId = await getCurrentTenantId(supabase);
  const tenantUser = currentTenantId ? { tenant_id: currentTenantId } : null;

  if (!tenantUser) {
    return <p className="text-sm text-alert">No tenant found for this account.</p>;
  }

  const [
    { data: tenant, error: tenantError },
    { data: aiConfig, error: configError },
    { data: sendingIdentity },
    { data: supportGrant },
    { data: supportVisits },
    me,
    adminView,
    { data: permissionRequired },
    { data: asariStatus },
  ] = await Promise.all([
    supabase.from("tenants").select("id, name, slug, industry, plan, status, timezone, avg_deal_value, assistant_mode").eq("id", tenantUser.tenant_id).single(),
    supabase
      .from("ai_config")
      .select("tenant_id, autonomy_rules, connected_gmail_address, google_calendar_id, crm_webhook_url, escalation_notify_email, whatsapp_phone_number_id, alert_email_enabled, alert_email, alert_whatsapp_enabled, alert_whatsapp_number, reminders_enabled, booking_notice_minutes, booking_buffer_minutes, email_from_name, email_inbound_last_at, email_inbound_last_from, email_forwarding_code, email_forwarding_url, email_forwarding_code_at, calendar_status")
      .eq("tenant_id", tenantUser.tenant_id)
      .single(),
    // 0039: the agency's own sending domain, when the Elliot administrator has set one up.
    supabase.from("email_sending_identities").select("from_address").eq("tenant_id", tenantUser.tenant_id).maybeSingle(),
    // 0040: who may open this dashboard from Elliot's side, and what they opened.
    supabase.from("support_access_grants").select("expires_at, granted_by_email, granted_at").eq("tenant_id", tenantUser.tenant_id).maybeSingle(),
    supabase
      .from("support_access_log")
      .select("id, admin_email, section, viewed_at")
      .eq("tenant_id", tenantUser.tenant_id)
      .order("viewed_at", { ascending: false })
      .limit(20),
    getMembership(supabase, user.id),
    getAdminView(supabase),
    supabase.rpc("support_permission_required"),
    // 0044: ASARI CRM connection, without the token.
    supabase.rpc("asari_status"),
  ]);

  if (tenantError || !tenant) {
    return <p className="text-sm text-alert">Failed to load settings: {tenantError?.message}</p>;
  }

  return (
    <div>
      <PageHeader title="Settings" description="Your business details, what Elliot may do on its own, and connected services." />
      <SettingsForm
        tenant={tenant}
        aiConfig={aiConfig}
        configError={configError?.message ?? null}
        ownFromAddress={sendingIdentity?.from_address ?? null}
        canEdit={me?.role === "admin" || !!adminView}
      />
      <div className="max-w-2xl">
        <AsariCard
          status={(asariStatus as AsariStatus | null) ?? { connected: false }}
          canChange={me?.role === "admin" || !!adminView}
          timeZone={tenant.timezone || "Europe/Warsaw"}
        />
      </div>
      {(tenant as { assistant_mode?: string }).assistant_mode === "agency" && (
        <div className="max-w-2xl">
          <SupportAccessCard
            grant={supportGrant ?? null}
            visits={supportVisits ?? []}
            canChange={me?.role === "admin"}
            timeZone={tenant.timezone || "Europe/Warsaw"}
            viewingAsSupport={!!adminView}
            required={permissionRequired !== false}
          />
        </div>
      )}
    </div>
  );
}
