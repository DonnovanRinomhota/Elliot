// Server-only: may the signed-in user manage the team of the agency they're
// looking at? Agency admins can; so can a platform admin using "view as".
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { getAdminView, getCurrentTenantId, getMembership } from "@/lib/tenant";

export async function getTeamManager() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", status: 401 as const };

  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return { error: "No agency found for this account.", status: 403 as const };

  const [me, adminView] = await Promise.all([getMembership(supabase, user.id), getAdminView(supabase)]);
  const allowed = me?.role === "admin" || (adminView === tenantId && isAdminEmail(user.email));
  if (!allowed) return { error: "Only an agency admin can do this.", status: 403 as const };

  return { user, tenantId, me };
}
