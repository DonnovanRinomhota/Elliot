// POST /api/admin/onboard
//
// Server-side proxy for n8n workflow 19 (tenant onboarding). The form used to
// call the n8n webhook straight from the browser, which meant the webhook had
// to be open to anyone who found its URL. Now:
//   - this route re-checks the caller is a platform admin (ADMIN_EMAILS) on
//     the server, not just by hiding the page, and
//   - forwards to n8n with the shared ELLIOT_WEBHOOK_SECRET header, which
//     workflow 19 now requires.
//
// Env: N8N_ONBOARD_WEBHOOK_URL (server-only). Falls back to the old
// NEXT_PUBLIC_N8N_ONBOARD_WEBHOOK_URL so an existing Vercel setup keeps
// working until it's renamed -- the URL itself isn't a secret any more.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { callInternalWebhook } from "@/lib/n8n-webhook";

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not signed in." }, { status: 401 });
  }
  if (!isAdminEmail(user.email)) {
    return NextResponse.json({ success: false, error: "Tenant onboarding is restricted to platform admins." }, { status: 403 });
  }

  let body: { name?: string; slug?: string; industry?: string; plan?: string; timezone?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const urlEnv = process.env.N8N_ONBOARD_WEBHOOK_URL ? "N8N_ONBOARD_WEBHOOK_URL" : "NEXT_PUBLIC_N8N_ONBOARD_WEBHOOK_URL";
  const result = await callInternalWebhook(urlEnv, {
    name: body.name,
    slug: body.slug,
    industry: body.industry || undefined,
    plan: body.plan,
    timezone: body.timezone,
  });

  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.data);
}
