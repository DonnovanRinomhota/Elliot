// POST   /api/platform/view-as { tenant_id }  -- start viewing an agency's dashboard
// DELETE /api/platform/view-as                -- stop
//
// Writes platform_admin_views with the service role after checking
// ADMIN_EMAILS. While the row exists (max 8 hours), current_tenant_id() in
// the database returns that agency for this admin, so every page and every
// RLS policy shows their data -- nothing in the pages needs to know.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformAdmin, logPlatformEvent } from "@/lib/platform-auth";

export async function POST(request: Request) {
  const user = await getPlatformAdmin();
  if (!user) return NextResponse.json({ success: false, error: "Platform admins only." }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const tenantId = String(body?.tenant_id || "");
  const admin = createAdminClient();
  const { data: tenant } = await admin.from("tenants").select("id, name").eq("id", tenantId).maybeSingle();
  if (!tenant) return NextResponse.json({ success: false, error: "Agency not found." }, { status: 404 });

  const { error } = await admin.from("platform_admin_views").upsert({
    auth_user_id: user.id,
    tenant_id: tenant.id,
    expires_at: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
  });
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  await logPlatformEvent(user.email!, "platform.view_as_started", tenant.id, {});
  return NextResponse.json({ success: true });
}

export async function DELETE() {
  // Anyone signed in may end their own view (e.g. after being removed from
  // ADMIN_EMAILS); it only ever deletes the caller's row.
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: "Not signed in." }, { status: 401 });

  const admin = createAdminClient();
  await admin.from("platform_admin_views").delete().eq("auth_user_id", user.id);
  return NextResponse.json({ success: true });
}
