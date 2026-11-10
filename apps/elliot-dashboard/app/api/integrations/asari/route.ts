// /api/integrations/asari -- an agency admin connects ASARI CRM (0044).
//   POST   { api_user_id, api_token?, enabled? }  save (token optional when
//          one is already saved: leaving the box empty keeps it)
//   DELETE                                         disconnect; listings
//          already copied stay, as typed listings that no longer update.
// The token is written with the service role and is never sent back.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTeamManager } from "@/lib/team-auth";
import { checkAsariCredentials } from "@/lib/asari";
import { callInternalWebhook, webhookConfigured } from "@/lib/n8n-webhook";

export async function POST(request: Request) {
  const ctx = await getTeamManager();
  if ("error" in ctx) return NextResponse.json({ success: false, error: ctx.error }, { status: ctx.status });

  let body: { api_user_id?: string; api_token?: string; enabled?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request." }, { status: 400 });
  }
  const userId = String(body.api_user_id ?? "").trim();
  const token = String(body.api_token ?? "").trim();

  const admin = createAdminClient();
  const { data: existing } = await admin.from("asari_connections").select("tenant_id").eq("tenant_id", ctx.tenantId).maybeSingle();
  const problem = checkAsariCredentials(userId, token, !existing);
  if (problem) return NextResponse.json({ success: false, error: problem }, { status: 400 });

  const row: Record<string, unknown> = { tenant_id: ctx.tenantId, api_user_id: userId, enabled: body.enabled ?? true };
  if (token) {
    row.api_token = token;
    // New credentials: forget the old result so Settings shows "waiting".
    Object.assign(row, { last_sync_at: null, last_sync_ok: null, last_sync_error: null, last_sync_counts: null });
  }
  const { error } = existing
    ? await admin.from("asari_connections").update(row).eq("tenant_id", ctx.tenantId)
    : await admin.from("asari_connections").insert(row);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  // First sync straight away when new credentials were saved (best effort).
  let syncing = false;
  if (token && row.enabled !== false && webhookConfigured("N8N_ASARI_SYNC_WEBHOOK_URL")) {
    syncing = (await callInternalWebhook("N8N_ASARI_SYNC_WEBHOOK_URL", { tenant_id: ctx.tenantId })).ok;
  }
  return NextResponse.json({ success: true, syncing });
}

export async function DELETE() {
  const ctx = await getTeamManager();
  if ("error" in ctx) return NextResponse.json({ success: false, error: ctx.error }, { status: ctx.status });
  const admin = createAdminClient();
  const { error } = await admin.from("asari_connections").delete().eq("tenant_id", ctx.tenantId);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  // Listings copied from ASARI stay; they become ordinary listings the agency edits itself.
  await admin.from("listings").update({ source: "manual", external_id: null, external_version: null }).eq("tenant_id", ctx.tenantId).eq("source", "asari");
  return NextResponse.json({ success: true });
}
