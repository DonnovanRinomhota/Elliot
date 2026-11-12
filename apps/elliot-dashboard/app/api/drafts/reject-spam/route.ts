// POST /api/drafts/reject-spam
//
// Rejects, in one go, every waiting draft Elliot itself classed as spam
// (replies to automatic notifications, newsletters and the like). Nothing is
// sent: each draft goes through the same reject_*_draft() as the Reject
// button on its card, so it's recorded as rejected by the signed-in person.
// The drafts are read through the user's own RLS session, so only their
// agency's are touched.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: "Not signed in." }, { status: 401 });

  const { data: me } = await supabase.from("tenant_users").select("id").eq("auth_user_id", user.id).maybeSingle();

  const [{ data: emails, error: e1 }, { data: whatsapps, error: e2 }] = await Promise.all([
    supabase.from("email_drafts").select("id").eq("status", "pending").eq("category", "spam"),
    supabase.from("whatsapp_drafts").select("id").eq("status", "pending").eq("category", "spam"),
  ]);
  if (e1 || e2) return NextResponse.json({ success: false, error: (e1 || e2)!.message }, { status: 500 });

  const jobs = [
    ...(emails ?? []).map((d: { id: string }) => ["reject_email_draft", d.id] as const),
    ...(whatsapps ?? []).map((d: { id: string }) => ["reject_whatsapp_draft", d.id] as const),
  ];
  let rejected = 0;
  const failed: string[] = [];
  // A few at a time, so a long list doesn't open hundreds of requests at once.
  for (let i = 0; i < jobs.length; i += 20) {
    const results = await Promise.all(
      jobs.slice(i, i + 20).map(([fn, id]) => supabase.rpc(fn, { p_draft_id: id, p_reviewed_by: me?.id ?? null }).then((r) => ({ id, error: r.error })))
    );
    for (const r of results) {
      if (r.error) failed.push(r.id);
      else rejected++;
    }
  }
  if (failed.length) {
    return NextResponse.json({ success: false, rejected, error: `${failed.length} could not be rejected. Try again.` }, { status: 500 });
  }
  return NextResponse.json({ success: true, rejected });
}
