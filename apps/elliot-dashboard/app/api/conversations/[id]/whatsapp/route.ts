// POST /api/conversations/:id/whatsapp   body: { content }
//
// A team member's reply in a WhatsApp conversation they have taken over.
// Sent through n8n workflow 32 (the WhatsApp token lives in n8n, not here),
// then saved in the conversation, so a message only shows as sent once
// WhatsApp has accepted it.
//
// Checks, in order: signed in; the conversation is read through the user's
// own RLS session (so it must be their agency's -- the tenant_id sent to n8n
// comes from that row, not from the request); it's a WhatsApp conversation;
// this user has taken it over; the client wrote within the last 24 hours
// (WhatsApp's rule; workflow 32 checks again).
//
// Env (server-only): N8N_SEND_WHATSAPP_MESSAGE_WEBHOOK_URL (workflow 32's
// Production URL) and ELLIOT_WEBHOOK_SECRET.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/tenant";
import { callInternalWebhook } from "@/lib/n8n-webhook";
import { whatsappReplyProblem, whatsappWindow } from "@/lib/whatsapp";

export const maxDuration = 30;

const WEBHOOK_ENV = "N8N_SEND_WHATSAPP_MESSAGE_WEBHOOK_URL";

const fail = (error: string, status: number) => NextResponse.json({ success: false, error }, { status });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not signed in.", 401);

  let content = "";
  try {
    const body = await request.json();
    content = typeof body?.content === "string" ? body.content.trim() : "";
  } catch {
    return fail("Invalid request body.", 400);
  }

  const { data: conversation, error: readError } = await supabase
    .from("conversations")
    .select("id, tenant_id, channel, assigned_human")
    .eq("id", params.id)
    .maybeSingle();
  if (readError) return fail(readError.message, 500);
  if (!conversation) return fail("Conversation not found.", 404);
  if (conversation.channel !== "whatsapp") return fail("This isn't a WhatsApp conversation.", 400);

  const me = await getMembership(supabase, user.id);
  if (!me || conversation.assigned_human !== me.id) {
    return fail("Take over the conversation before replying.", 409);
  }

  const { data: lastInbound } = await supabase
    .from("messages")
    .select("created_at")
    .eq("conversation_id", conversation.id)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const problem = whatsappReplyProblem(content, whatsappWindow(lastInbound?.created_at ?? null));
  if (problem) return fail(problem, problem === "Write a message first." ? 400 : 409);

  const sent = await callInternalWebhook(WEBHOOK_ENV, {
    tenant_id: conversation.tenant_id,
    conversation_id: conversation.id,
    content,
  });
  if (!sent.ok) return fail(sent.error, sent.status);

  const { data: messageId, error: saveError } = await supabase.rpc("send_human_chat_message", {
    p_conversation_id: conversation.id,
    p_content: content,
  });
  if (saveError) {
    return fail(`Sent on WhatsApp, but it couldn't be saved here: ${saveError.message}`, 500);
  }
  return NextResponse.json({ success: true, message_id: messageId });
}
