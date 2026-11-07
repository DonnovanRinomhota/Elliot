// Server-only guard + audit helper for the platform control panel.
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin";

/** The signed-in platform admin, or null (not signed in / not in ADMIN_EMAILS). */
export async function getPlatformAdmin() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) return null;
  return user;
}

/** Records a control-panel action in audit_log (shown under Activity log). */
export async function logPlatformEvent(
  actorEmail: string,
  eventType: string,
  tenantId: string | null,
  details: Record<string, unknown> = {}
) {
  const admin = createAdminClient();
  await admin.from("audit_log").insert({
    tenant_id: tenantId,
    actor_type: "system",
    actor_id: actorEmail,
    event_type: eventType,
    details,
  });
}
