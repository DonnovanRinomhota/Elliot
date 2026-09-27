"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// channel decides which table/RPC/send-webhook this card talks to --
// email_drafts + approve_email_draft() + NEXT_PUBLIC_N8N_SEND_WEBHOOK_URL,
// or whatsapp_drafts + approve_whatsapp_draft() +
// NEXT_PUBLIC_N8N_SEND_WHATSAPP_WEBHOOK_URL. Two sibling tables, not one --
// see migration 0025's header comment for why.
type Draft = {
  id: string;
  channel: "email" | "whatsapp";
  to_email?: string; // email only
  to_wa_id?: string; // whatsapp only
  subject?: string | null; // email only -- whatsapp has no subject line
  body: string;
  category: string;
  confidence: string | number;
  status: string;
  created_at: string;
};

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-soft text-amber-dark",
  auto_sent: "bg-violet-50 text-violet-600",
  approved: "bg-pulse-soft text-pulse-dark",
  rejected: "bg-coral-soft text-coral-dark",
  // Only ever set on a whatsapp_drafts row -- see
  // docs/workflow-specs/27-send-approved-whatsapp.md ("the 24-hour window").
  blocked_needs_template: "bg-coral-soft text-coral-dark",
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

  const isWhatsapp = draft.channel === "whatsapp";
  const approveRpc = isWhatsapp ? "approve_whatsapp_draft" : "approve_email_draft";
  const rejectRpc = isWhatsapp ? "reject_whatsapp_draft" : "reject_email_draft";
  const sendWebhookUrl = isWhatsapp
    ? process.env.NEXT_PUBLIC_N8N_SEND_WHATSAPP_WEBHOOK_URL
    : process.env.NEXT_PUBLIC_N8N_SEND_WEBHOOK_URL;

  async function handleApprove() {
    setBusy(true);
    setError(null);

    const reviewedBy = await getTenantUserId();

    // approve_*_draft() marks the row approved and optionally overwrites the
    // body with an edited version. It does NOT send anything itself -- that's
    // workflow 27 (WhatsApp) or 15 (email)'s job, triggered next via the
    // matching n8n webhook below.
    const { error: rpcError } = await supabase.rpc(approveRpc, {
      p_draft_id: draft.id,
      p_reviewed_by: reviewedBy,
      p_edited_body: isEditing ? editedBody : null,
    });

    if (rpcError) {
      setError(rpcError.message);
      setBusy(false);
      return;
    }

    if (!sendWebhookUrl) {
      setError(
        isWhatsapp
          ? "Approved, but NEXT_PUBLIC_N8N_SEND_WHATSAPP_WEBHOOK_URL isn't set -- see apps/elliot-dashboard/README.md."
          : "Approved, but NEXT_PUBLIC_N8N_SEND_WEBHOOK_URL isn't set -- see apps/elliot-dashboard/README.md."
      );
      setBusy(false);
      return;
    }

    try {
      const res = await fetch(sendWebhookUrl, {
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

    const { error: rpcError } = await supabase.rpc(rejectRpc, {
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
          <span
            style={{
              display: "inline-block",
              marginRight: 8,
              padding: "1px 6px",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
              background: isWhatsapp ? "#dcfce7" : "#e0e7ff",
              color: isWhatsapp ? "#166534" : "#4338ca",
            }}
          >
            {isWhatsapp ? "WhatsApp" : "Email"}
          </span>
          <strong>{isWhatsapp ? draft.to_wa_id : draft.to_email}</strong>
          <span style={{ marginLeft: 8, fontSize: 12, color: "#999" }}>
            {draft.category} · confidence {draft.confidence}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            className={`rounded-md px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[draft.status] || "bg-gray-100 text-gray-600"}`}
          >
            {draft.status.replace(/_/g, " ")}
          </span>
          <span style={{ fontSize: 12, color: "#999" }}>
            {new Date(draft.created_at).toLocaleString("en-GB", { timeZone: "UTC" })}
          </span>
        </div>
      </div>

      {!isWhatsapp && <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{draft.subject}</div>}

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

      {draft.status === "blocked_needs_template" && (
        <p style={{ fontSize: 12, color: "#b91c1c", marginTop: 12 }}>
          Blocked -- more than 24 hours have passed since this contact's last WhatsApp message, so a free-form
          reply can no longer be sent (Meta's rule, not ours). Sending this now needs a pre-approved WhatsApp
          template message, which isn't set up yet. See docs/workflow-specs/27-send-approved-whatsapp.md.
        </p>
      )}

      {draft.status === "pending" ? (
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
      ) : (
        <p style={{ fontSize: 12, color: "#999", marginTop: 12 }}>
          {draft.status === "auto_sent"
            ? "Sent automatically -- no review needed."
            : draft.status === "blocked_needs_template"
              ? null
              : `Already ${draft.status}. No further action.`}
        </p>
      )}
    </div>
  );
}
