// POST /api/platform/tenants/:id/trial -- control panel: start (or restart)
// an agency's free trial at go-live. Platform admins only; the database
// function sets the dates and records it in the activity log (0050). When the
// trial ends, Elliot pauses for that agency: clients get a short holding reply.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformAdmin } from "@/lib/platform-auth";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getPlatformAdmin();
  if (!user) return NextResponse.json({ success: false, error: "Platform admins only." }, { status: 403 });

  let body: { days?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    /* default length */
  }
  const days = Number(body.days ?? 7);
  if (!Number.isInteger(days) || days < 1 || days > 60) {
    return NextResponse.json({ success: false, error: "A trial is 1 to 60 days." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("start_trial", { p_tenant_id: params.id, p_days: days, p_actor: user.email ?? "platform" });
  if (error) {
    const missing = /start_trial/.test(error.message) && /function|schema cache/i.test(error.message);
    return NextResponse.json(
      { success: false, error: missing ? "Run migration 0050 in Supabase first." : error.message },
      { status: /not found/i.test(error.message) ? 404 : 500 }
    );
  }
  return NextResponse.json({ success: true, trial_ends_at: (data as { trial_ends_at?: string } | null)?.trial_ends_at ?? null });
}
