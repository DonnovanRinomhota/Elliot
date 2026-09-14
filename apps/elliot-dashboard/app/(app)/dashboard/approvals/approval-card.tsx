"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Draft = {
  id: string;
  to_email: string;
  subject: string | null;
  body: string;
  category: string;
  confidence: string | number;
  created_at: string;
};

export default function ApprovalCard({ draft }: { draft: Draft }) {
  const router = useRouter();
  const supabase = createClient();
  const [editedBody, setEditedBody] = useState(draft.body);
  const [isEditing, setIsEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function getTenantUserId() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    // email_drafts.reviewed_by references tenant_users(id), NOT the Supabase
    // Auth user's own id -- these are two different UUIDs, so we look it up.
    const { data: tenantUser } = await supabase
      .from("tenant_users")
      .select("id")
      .eq("auth_user_id", user.id)
      .single();

    return tenantUser?.id ?? null;
  }

  async function handleApprove() {
    setBusy(true);
    setError(null);

    const reviewedBy = await getTenantUserId();

    // approve_email_draft() marks the row approved and optionally overwrites the
    // body with an edited version. It does NOT send the email itself -- that's
    // workflow 15's job, triggered next via the n8n webhook below.
    const { error: rpcError } = await supabase.rpc("approve_email_draft", {
      p_draft_id: draft.id,
      p_reviewed_by: reviewedBy,
      p_edited_body: isEditing ? editedBody : null,
    });

    if (rpcError) {
      setError(rpcError.message);
      setBusy(false);
      return;
    }

    try {
      const res = await fetch(process.env.NEXT_PUBLIC_N8N_SEND_WEBHOOK_URL!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft_id: draft.id }),
      });
      if (!res.ok) throw new Error(`Send webhook returned ${res.status}`);
    } catch (e) {
      setError("Approved, but sending failed -- check n8n. " + (e as Error).message);
      setBusy(false);
      return;
    }

    setBusy(false);
    router.refresh();
  }

  async function handleReject() {
    setBusy(true);
    setError(null);

    const reviewedBy = await getTenantUserId();

    const { error: rpcError } = await supabase.rpc("reject_email_draft", {
      p_draft_id: draft.id,
      p_reviewed_by: reviewedBy,
    });

    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.refresh();
  }

  return (
    <div style={{ background: "white", border: "1px solid #eee", borderRadius: 10, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <div>
          <strong>{draft.to_email}</strong>
          <span style={{ marginLeft: 8, fontSize: 12, color: "#999" }}>
            {draft.category} · confidence {draft.confidence}
          </span>
        </div>
        <span style={{ fontSize: 12, color: "#999" }}>
          {new Date(draft.created_at).toLocaleString("en-GB", { timeZone: "UTC" })}
        </span>
      </div>

      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{draft.subject}</div>

      {isEditing ? (
        <textarea
          value={editedBody}
          onChange={(e) => setEditedBody(e.target.value)}
          rows={8}
          style={{ width: "100%", padding: 10, border: "1px solid #ddd", borderRadius: 6, fontFamily: "inherit", fontSize: 14 }}
        />
      ) : (
        <p style={{ whiteSpace: "pre-wrap", fontSize: 14, color: "#333" }}>{draft.body}</p>
      )}

      {error && <p style={{ color: "crimson", fontSize: 13, marginTop: 8 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button
          onClick={handleApprove}
          disabled={busy}
          style={{ padding: "8px 16px", background: "#111", color: "white", border: "none", borderRadius: 6, cursor: "pointer" }}
        >
          {isEditing ? "Save & Send" : "Approve & Send"}
        </button>
        <button
          onClick={() => setIsEditing((v) => !v)}
          disabled={busy}
          style={{ padding: "8px 16px", background: "white", border: "1px solid #ddd", borderRadius: 6, cursor: "pointer" }}
        >
          {isEditing ? "Cancel Edit" : "Edit"}
        </button>
        <button
          onClick={handleReject}
          disabled={busy}
          style={{ padding: "8px 16px", background: "white", color: "crimson", border: "1px solid #fbb", borderRadius: 6, cursor: "pointer" }}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
