import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/tenant";
import { DEFAULT_TZ } from "@/lib/appointments";
import { parseQuestion } from "@/lib/assistant/parse";
import { answer } from "@/lib/assistant/run";

// The built-in assistant ("Ask Elliot" in the dashboard). Rules, not an AI
// service: the question is parsed (lib/assistant/parse.ts) and answered from
// the agency's own data through the signed-in user's connection, so RLS
// limits it to their agency. Nothing is sent anywhere else.
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let question = "";
  try {
    question = String(((await req.json()) as { q?: unknown }).q ?? "").slice(0, 300);
  } catch {
    return NextResponse.json({ error: "Send { q: your question }." }, { status: 400 });
  }

  const [{ data: tenant }, me] = await Promise.all([supabase.from("tenants").select("timezone").maybeSingle(), getMembership(supabase, user.id)]);
  const tz = (tenant as { timezone?: string } | null)?.timezone || DEFAULT_TZ;
  const now = new Date();
  const intent = parseQuestion(question, now, tz);
  try {
    const result = await answer(intent, {
      supabase,
      tz,
      now,
      me: me ? { id: me.id, full_name: me.full_name, email: me.email } : null,
    });
    return NextResponse.json({ intent: intent.kind, ...result });
  } catch (e) {
    return NextResponse.json({ intent: intent.kind, text: `Something went wrong looking that up: ${(e as Error).message}` });
  }
}
