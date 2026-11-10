// PATCH /api/platform/settings { support_permission_required } -- the
// platform-wide switch from migration 0041. Platform admins only (with
// two-step sign-in); written with the service role and recorded.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformAdmin, logPlatformEvent } from "@/lib/platform-auth";

export async function PATCH(request: Request) {
  const user = await getPlatformAdmin();
  if (!user) return NextResponse.json({ success: false, error: "Platform admins only." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (typeof body?.support_permission_required !== "boolean") {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }
  const admin = createAdminClient();
  const { error } = await admin.from("platform_settings").upsert({
    id: true,
    support_permission_required: body.support_permission_required,
    updated_at: new Date().toISOString(),
    updated_by: user.email,
  });
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  await logPlatformEvent(user.email!, "platform.support_permission_changed", null, { required: body.support_permission_required });
  return NextResponse.json({ success: true });
}
