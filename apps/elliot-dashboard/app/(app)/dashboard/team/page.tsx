import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminView, getCurrentTenantId, getMembership } from "@/lib/tenant";
import { PageHeader } from "../../../_ui/ui";
import TeamManager, { type Member } from "./team-manager";
import CalendarsPanel from "./calendars-panel";

export default async function TeamPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return <p className="text-[13px] text-alert">No agency found for this account.</p>;

  const [me, adminView, { data: members, error }, { data: openLeads }, { data: config }, { data: elliotAccount }] = await Promise.all([
    getMembership(supabase, user.id),
    getAdminView(supabase),
    supabase
      .from("tenant_users")
      .select("id, email, full_name, role, receives_leads, notify_escalations, notify_digest, created_at, last_assigned_at, google_calendar_id, calendar_status, calendar_error, calendar_checked_at")
      .is("removed_at", null)
      .order("created_at"),
    // Open leads per person (not converted or lost).
    supabase.from("leads").select("assigned_to").not("status", "in", "(CONVERTED,LOST)"),
    supabase.from("ai_config").select("daily_digest_enabled, escalation_notify_email, google_calendar_id").eq("tenant_id", tenantId).maybeSingle(),
    // 0042: the Google account agents share their calendars with.
    supabase.rpc("elliot_calendar_account"),
  ]);

  const leadCounts: Record<string, number> = {};
  (openLeads ?? []).forEach((l: any) => {
    if (l.assigned_to) leadCounts[l.assigned_to] = (leadCounts[l.assigned_to] ?? 0) + 1;
  });
  const unassigned = (openLeads ?? []).filter((l: any) => !l.assigned_to).length;
  const canManage = Boolean(adminView) || me?.role === "admin";

  return (
    <div>
      <PageHeader
        title="Team"
        description="Who uses Elliot at your agency, who new leads go to, and who gets alerts."
      />
      {error && <p className="mb-4 text-[13px] text-alert">Couldn&apos;t load the team: {error.message}</p>}
      <TeamManager
        tenantId={tenantId}
        members={(members ?? []).map((m: any): Member => ({ ...m, open_leads: leadCounts[m.id] ?? 0 }))}
        meId={me?.id ?? null}
        canManage={canManage}
        unassignedLeads={unassigned}
        digestEnabled={config?.daily_digest_enabled ?? true}
        agencyAlertEmail={config?.escalation_notify_email ?? null}
      />
      <div className="mt-6">
        <CalendarsPanel
          members={(members ?? []) as any}
          meId={me?.id ?? null}
          canManage={canManage}
          elliotAccount={(elliotAccount as string | null) ?? null}
          agencyCalendar={config?.google_calendar_id ?? null}
        />
      </div>
    </div>
  );
}
