// POST /api/integrations/asari/sync -- "Sync now" (0044). Starts workflow 42
// for this agency; n8n answers at once and the result appears in Settings
// when the sync finishes (about 3 seconds per new or changed listing,
// because ASARI allows 25 requests a minute).
//
// Env: N8N_ASARI_SYNC_WEBHOOK_URL (workflow 42's Production URL) and ELLIOT_WEBHOOK_SECRET.
import { NextResponse } from "next/server";
import { getTeamManager } from "@/lib/team-auth";
import { callInternalWebhook } from "@/lib/n8n-webhook";

export async function POST() {
  const ctx = await getTeamManager();
  if ("error" in ctx) return NextResponse.json({ success: false, error: ctx.error }, { status: ctx.status });
  const result = await callInternalWebhook("N8N_ASARI_SYNC_WEBHOOK_URL", { tenant_id: ctx.tenantId });
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  return NextResponse.json({ success: true });
}
