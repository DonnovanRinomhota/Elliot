// POST /api/drafts/:id/send   body: { channel: "email" | "whatsapp" }
//
// Sends an already-approved draft through n8n: workflow 17 (email, which
// hands off to 15) or 28 (WhatsApp, which hands off to 27). Used by the
// Approvals page after approve_*_draft(), and by "Reply as human" after
// create_manual_email_draft().
//
// The browser used to call those webhooks directly via NEXT_PUBLIC_* URLs,
// so anyone with the URL and a draft id could trigger a send. Now:
//   - the draft is read through the user's own RLS session, so it must
//     belong to their tenant, and
//   - it must already be 'approved' (17/28 themselves don't check that), and
//   - n8n is called server-side with the shared webhook secret (Header Auth).
//
// Env (server-only): N8N_SEND_WEBHOOK_URL / N8N_SEND_WHATSAPP_WEBHOOK_URL.
// Falls back to the old NEXT_PUBLIC_* names so an existing Vercel setup keeps
// working until they're renamed.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callInternalWebhook } from "@/lib/n8n-webhook";

export const maxDuration = 30;

const CHANNELS = {
  email: { table: "email_drafts", urlEnv: "N8N_SEND_WEBHOOK_URL", legacyEnv: "NEXT_PUBLIC_N8N_SEND_WEBHOOK_URL" },
  whatsapp: {
    table: "whatsapp_drafts",
    urlEnv: "N8N_SEND_WHATSAPP_WEBHOOK_URL",
    legacyEnv: "NEXT_PUBLIC_N8N_SEND_WHATSAPP_WEBHOOK_URL",
  },
} as const;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not signed in." }, { status: 401 });
  }

  let body: { channel?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }
  const channel = body.channel === "whatsapp" ? CHANNELS.whatsapp : body.channel === "email" ? CHANNELS.email : null;
  if (!channel) {
    return NextResponse.json({ success: false, error: "channel must be 'email' or 'whatsapp'." }, { status: 400 });
  }

  const { data: draft, error: readError } = await supabase
    .from(channel.table)
    .select("id, status")
    .eq("id", params.id)
    .maybeSingle();
  if (readError) {
    return NextResponse.json({ success: false, error: readError.message }, { status: 500 });
  }
  if (!draft) {
    return NextResponse.json({ success: false, error: "Draft not found." }, { status: 404 });
  }
  if (draft.status !== "approved") {
    return NextResponse.json(
      { success: false, error: `This draft is ${draft.status.replace(/_/g, " ")}, not approved, so it wasn't sent.` },
      { status: 409 }
    );
  }

  const urlEnv = process.env[channel.urlEnv] ? channel.urlEnv : channel.legacyEnv;
  const result = await callInternalWebhook(urlEnv, { draft_id: draft.id });
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ success: true, draft_id: draft.id });
}
