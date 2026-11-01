import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "../../../_ui/ui";
import SettingsForm from "./settings-form";

export default async function SettingsPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: tenantUser } = await supabase
    .from("tenant_users")
    .select("tenant_id")
    .eq("auth_user_id", user.id)
    .single();

  if (!tenantUser) {
    return <p className="text-sm text-alert">No tenant found for this account.</p>;
  }

  const [{ data: tenant, error: tenantError }, { data: aiConfig, error: configError }] = await Promise.all([
    supabase.from("tenants").select("id, name, industry, plan, status, timezone, avg_deal_value").eq("id", tenantUser.tenant_id).single(),
    supabase
      .from("ai_config")
      .select("tenant_id, autonomy_rules, connected_gmail_address, google_calendar_id, crm_webhook_url, escalation_notify_email, whatsapp_phone_number_id")
      .eq("tenant_id", tenantUser.tenant_id)
      .single(),
  ]);

  if (tenantError || !tenant) {
    return <p className="text-sm text-alert">Failed to load settings: {tenantError?.message}</p>;
  }

  return (
    <div>
      <PageHeader title="Settings" description="Your business details, what Elliot may do on its own, and connected services." />
      <SettingsForm tenant={tenant} aiConfig={aiConfig} configError={configError?.message ?? null} />
    </div>
  );
}
