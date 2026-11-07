// DELETE /api/team/:id -- remove someone from the agency.
// Their login is deleted (they can't sign in any more) and their open leads
// and chats are released. The tenant_users row stays, marked removed_at, so
// past approvals and escalations still show who handled them.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTeamManager } from "@/lib/team-auth";
import { logPlatformEvent } from "@/lib/platform-auth";

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const ctx = await getTeamManager();
  if ("error" in ctx) return NextResponse.json({ success: false, error: ctx.error }, { status: ctx.status });
  if (ctx.me?.id === params.id) {
    return NextResponse.json({ success: false, error: "You can't remove yourself." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("tenant_users")
    .select("id, auth_user_id, email, role")
    .eq("id", params.id)
    .eq("tenant_id", ctx.tenantId)
    .is("removed_at", null)
    .maybeSingle();
  if (!member) return NextResponse.json({ success: false, error: "Team member not found." }, { status: 404 });

  if (member.role === "admin") {
    const { count } = await admin
      .from("tenant_users")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenantId)
      .eq("role", "admin")
      .is("removed_at", null);
    if ((count ?? 0) <= 1) {
      return NextResponse.json({ success: false, error: "An agency needs at least one admin." }, { status: 400 });
    }
  }

  // Release their work so nothing waits on someone who has left.
  await Promise.all([
    admin.from("leads").update({ assigned_to: null }).eq("assigned_to", member.id).not("status", "in", "(CONVERTED,LOST)"),
    admin.from("conversations").update({ assigned_human: null, status: "open" }).eq("assigned_human", member.id),
    admin.from("escalations").update({ assigned_to: null }).eq("assigned_to", member.id).neq("status", "resolved"),
  ]);

  const { error } = await admin
    .from("tenant_users")
    .update({ removed_at: new Date().toISOString(), receives_leads: false, notify_escalations: false, notify_digest: false })
    .eq("id", member.id);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const { error: authError } = await admin.auth.admin.deleteUser(member.auth_user_id);
  if (authError && !/not found/i.test(authError.message)) {
    return NextResponse.json({ success: false, error: `Removed from the team, but their login couldn't be deleted: ${authError.message}` }, { status: 500 });
  }

  await logPlatformEvent(ctx.user.email!, "team.member_removed", ctx.tenantId, { email: member.email });
  return NextResponse.json({ success: true });
}
