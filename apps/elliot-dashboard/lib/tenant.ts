// Which agency the signed-in user is looking at.
//
// Always ask the database (current_tenant_id()) rather than looking up
// tenant_users by auth_user_id: a platform admin using "View as this agency"
// is looking at a tenant they are not a member of, and current_tenant_id()
// is what every RLS policy uses, so the page and the data always agree.
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getCurrentTenantId(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.rpc("current_tenant_id");
  if (error || !data) return null;
  return data as string;
}

export type Membership = {
  id: string;
  role: "admin" | "agent" | "viewer";
  email: string;
  full_name: string | null;
} | null;

/**
 * The signed-in user's own row in the current agency, or null when a platform
 * admin is viewing an agency they don't belong to.
 */
export async function getMembership(supabase: SupabaseClient, authUserId: string): Promise<Membership> {
  const { data } = await supabase
    .from("tenant_users")
    .select("id, role, email, full_name")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  return (data as Membership) ?? null;
}

/** The agency id a platform admin is currently viewing as, if any. */
export async function getAdminView(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.rpc("current_admin_view");
  return (data as string | null) ?? null;
}
