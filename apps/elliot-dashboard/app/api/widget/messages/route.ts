// GET /api/widget/messages?tenant=<slug>&conversation_id=<uuid>&after=<ISO>
//
// Public, called by the chat widget on agencies' websites every few seconds
// while the chat is open, to show replies a team member typed in the
// dashboard after taking over. Returns only team replies (human_agent) for
// that one conversation, plus whether a person is currently handling it.
//
// Access: the conversation id is a random UUID the widget got back from the
// chat webhook and keeps in the visitor's sessionStorage; it must also match
// the agency slug. Nothing else is exposed (no visitor details, no Elliot
// messages, no other conversations).
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("tenant") || "";
  const conversationId = url.searchParams.get("conversation_id") || "";
  const afterRaw = url.searchParams.get("after");
  const after = afterRaw && !Number.isNaN(Date.parse(afterRaw)) ? new Date(afterRaw).toISOString() : new Date(0).toISOString();

  if (!slug || !UUID.test(conversationId)) {
    return NextResponse.json({ error: "tenant and conversation_id are required" }, { status: 400, headers: CORS });
  }

  const admin = createAdminClient();
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", slug).maybeSingle();
  const { data: conv } = tenant
    ? await admin
        .from("conversations")
        .select("id, assigned_human, handler:tenant_users!conversations_assigned_human_fkey(full_name)")
        .eq("id", conversationId)
        .eq("tenant_id", tenant.id)
        .maybeSingle()
    : { data: null };
  if (!conv) {
    return NextResponse.json({ human_active: false, agent_name: null, messages: [] }, { headers: CORS });
  }

  const { data: msgs } = await admin
    .from("messages")
    .select("id, content, created_at")
    .eq("conversation_id", conversationId)
    .eq("role", "human_agent")
    .gt("created_at", after)
    .order("created_at", { ascending: true })
    .limit(50);

  const handler = conv.handler as unknown as { full_name: string | null } | null;
  return NextResponse.json(
    {
      human_active: Boolean(conv.assigned_human),
      // First name only: enough for "Ola from the team", no full identity.
      agent_name: handler?.full_name ? handler.full_name.split(" ")[0] : null,
      messages: msgs ?? [],
    },
    { headers: CORS }
  );
}
