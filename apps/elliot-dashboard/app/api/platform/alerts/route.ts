// PATCH /api/platform/alerts -- where system alerts go (platform_alert_settings,
// migration 0036). Platform admins only (ADMIN_EMAILS), checked here on the
// server; writes with the service role and records the change.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformAdmin, logPlatformEvent } from "@/lib/platform-auth";
import { checkAlertChannels } from "@/lib/alerts";

const REPEAT_HOURS = [1, 3, 6, 12, 24];

export async function PATCH(request: Request) {
  const user = await getPlatformAdmin();
  if (!user) return NextResponse.json({ success: false, error: "Platform admins only." }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const checked = checkAlertChannels({
    email_enabled: body.email_enabled === true,
    email: String(body.email ?? ""),
    whatsapp_enabled: body.whatsapp_enabled === true,
    whatsapp: String(body.whatsapp ?? ""),
  });
  if (!checked.ok) return NextResponse.json({ success: false, error: checked.error }, { status: 400 });

  const sender = String(body.whatsapp_sender_id ?? "").trim();
  if (sender && !/^\d{6,}$/.test(sender)) {
    return NextResponse.json({ success: false, error: "The phone number ID is a long number from Meta's API Setup page." }, { status: 400 });
  }
  if (checked.value.whatsapp_enabled && !sender) {
    return NextResponse.json({ success: false, error: "WhatsApp alerts need the phone number ID they are sent from." }, { status: 400 });
  }
  const repeat = Number(body.repeat_hours);
  if (!REPEAT_HOURS.includes(repeat)) {
    return NextResponse.json({ success: false, error: "Choose how often to repeat an alert." }, { status: 400 });
  }

  const update = {
    email_enabled: checked.value.email_enabled,
    email_to: checked.value.email,
    whatsapp_enabled: checked.value.whatsapp_enabled,
    whatsapp_to: checked.value.whatsapp,
    whatsapp_sender_id: sender || null,
    daily_summary_enabled: body.daily_summary_enabled === true,
    repeat_hours: repeat,
    updated_at: new Date().toISOString(),
  };

  const admin = createAdminClient();
  const { error } = await admin.from("platform_alert_settings").update(update).eq("id", true);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  await logPlatformEvent(user.email ?? "admin", "platform.alerts_updated", null, {
    email: update.email_enabled ? "on" : "off",
    whatsapp: update.whatsapp_enabled ? "on" : "off",
  });
  return NextResponse.json({ success: true });
}
