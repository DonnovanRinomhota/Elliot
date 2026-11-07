// POST /api/team/invite { email, full_name, role }
// Agency admins (or a platform admin viewing the agency) invite a colleague.
// Supabase sends the invitation email; the link lands on /reset-password so
// they choose their own password.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTeamManager } from "@/lib/team-auth";
import { logPlatformEvent } from "@/lib/platform-auth";

export async function POST(request: Request) {
  const ctx = await getTeamManager();
  if ("error" in ctx) return NextResponse.json({ success: false, error: ctx.error }, { status: ctx.status });

  const body = await request.json().catch(() => ({}));
  const email = String(body?.email || "").trim().toLowerCase();
  const fullName = String(body?.full_name || "").trim() || null;
  const role = ["admin", "agent", "viewer"].includes(body?.role) ? body.role : "agent";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ success: false, error: "Enter a valid email address." }, { status: 400 });
  }

  const admin = createAdminClient();
  // One person, one agency: the dashboard can't switch between agencies.
  const { data: existing } = await admin
    .from("tenant_users")
    .select("tenant_id")
    .ilike("email", email)
    .is("removed_at", null)
    .limit(1);
  if (existing?.length) {
    return NextResponse.json(
      { success: false, error: existing[0].tenant_id === ctx.tenantId ? "They're already in your team." : "This email already has an Elliot account with another agency." },
      { status: 409 }
    );
  }

  const origin = request.headers.get("origin") || new URL(request.url).origin;
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/reset-password`,
    data: { full_name: fullName },
  });
  if (inviteError || !invited?.user) {
    return NextResponse.json(
      { success: false, error: inviteError?.message?.includes("already been registered") ? "This email already has a login. Ask them to sign in, or remove the old login in Supabase first." : inviteError?.message || "Invitation failed." },
      { status: 400 }
    );
  }

  const { error: insertError } = await admin.from("tenant_users").insert({
    tenant_id: ctx.tenantId,
    auth_user_id: invited.user.id,
    email,
    full_name: fullName,
    role,
  });
  if (insertError) {
    await admin.auth.admin.deleteUser(invited.user.id); // don't leave a login with no agency
    return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
  }

  await logPlatformEvent(ctx.user.email!, "team.member_invited", ctx.tenantId, { email, role });
  return NextResponse.json({ success: true });
}
