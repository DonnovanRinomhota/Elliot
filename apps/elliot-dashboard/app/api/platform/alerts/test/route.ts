// POST /api/platform/alerts/test -- asks workflow 33 to send a test alert to
// the platform's alert email and WhatsApp. Platform admins only.
//
// Webhook URL: N8N_HEALTH_TEST_WEBHOOK_URL, or worked out from
// N8N_ONBOARD_WEBHOOK_URL (same n8n, path /webhook/health-test-alert) so
// there's nothing new to set in Vercel.
import { NextResponse } from "next/server";
import { getPlatformAdmin } from "@/lib/platform-auth";
import { callInternalWebhook } from "@/lib/n8n-webhook";

export async function POST() {
  const user = await getPlatformAdmin();
  if (!user) return NextResponse.json({ success: false, error: "Platform admins only." }, { status: 403 });

  if (!process.env.N8N_HEALTH_TEST_WEBHOOK_URL) {
    const base = process.env.N8N_ONBOARD_WEBHOOK_URL || process.env.NEXT_PUBLIC_N8N_ONBOARD_WEBHOOK_URL || "";
    const m = base.match(/^(https?:\/\/[^/]+\/webhook)\//);
    if (!m) {
      return NextResponse.json(
        { success: false, error: "Set N8N_HEALTH_TEST_WEBHOOK_URL in Vercel to workflow 33's test-alert webhook URL." },
        { status: 500 }
      );
    }
    process.env.N8N_HEALTH_TEST_WEBHOOK_URL = `${m[1]}/health-test-alert`;
  }

  const result = await callInternalWebhook("N8N_HEALTH_TEST_WEBHOOK_URL", { requested_by: user.email });
  if (!result.ok) {
    const hint = result.status === 404 ? " Is workflow 33 imported and published in n8n?" : "";
    return NextResponse.json({ success: false, error: result.error + hint }, { status: 502 });
  }
  return NextResponse.json({ success: true });
}
