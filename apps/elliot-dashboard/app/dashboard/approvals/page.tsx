import { createClient } from "@/lib/supabase/server";
import ApprovalCard from "./approval-card";

export default async function ApprovalsPage() {
  const supabase = createClient();

  // RLS scopes this to the logged-in user's tenant automatically -- no manual
  // tenant_id filter needed here as long as email_drafts' RLS policy checks
  // tenant_users via auth_user_id = auth.uid().
  const { data: drafts, error } = await supabase
    .from("email_drafts")
    .select("id, to_email, subject, body, category, confidence, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    return <p style={{ color: "crimson" }}>Failed to load pending approvals: {error.message}</p>;
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Pending Approvals</h1>
      <p style={{ color: "#666", marginBottom: 24, fontSize: 14 }}>
        {drafts?.length ?? 0} email{drafts?.length === 1 ? "" : "s"} waiting for review
      </p>

      {(!drafts || drafts.length === 0) && (
        <p style={{ color: "#999" }}>Nothing pending right now.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {drafts?.map((draft) => (
          <ApprovalCard key={draft.id} draft={draft} />
        ))}
      </div>
    </div>
  );
}
