// POST /api/team/calendar-check -- asks n8n (workflow 41) what Elliot's
// Google account can do with each calendar of the agency the user is looking
// at, and saves the answer (0042). Anyone on the team may run it; it changes
// nothing except the status shown on the Team page.
//
// Env: N8N_CALENDAR_CHECK_WEBHOOK_URL (workflow 41's Production URL) and
// ELLIOT_WEBHOOK_SECRET.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/tenant";
import { callInternalWebhook } from "@/lib/n8n-webhook";

export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: "Not signed in." }, { status: 401 });
  const tenantId = await getCurrentTenantId(supabase);
  if (!tenantId) return NextResponse.json({ success: false, error: "No agency found for this account." }, { status: 403 });

  const result = await callInternalWebhook("N8N_CALENDAR_CHECK_WEBHOOK_URL", { tenant_id: tenantId });
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  return NextResponse.json({ success: true, account_email: result.data?.account_email ?? null });
}
