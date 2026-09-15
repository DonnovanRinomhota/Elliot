"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ReplyForm({
  conversationId,
  contactId,
  toEmail,
  defaultSubject,
}: {
  conversationId: string;
  contactId: string | null;
  toEmail: string;
  defaultSubject: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function getTenantUserId() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: tenantUser } = await supabase
      .from("tenant_users")
      .select("id")
      .eq("auth_user_id", user.id)
      .single();

    return tenantUser?.id ?? null;
  }

  async function handleSend() {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);

    const reviewedBy = await getTenantUserId();

    // Inserts an already-approved draft (see 0023_manual_email_draft_rpc.sql)
    // then reuses the exact same send pipeline approval-card.tsx uses for
    // AI drafts (workflow 17 -> 15), rather than building a second path.
    const { data: draft, error: rpcError } = await supabase.rpc("create_manual_email_draft", {
      p_conversation_id: conversationId,
      p_contact_id: contactId,
      p_to_email: toEmail,
      p_subject: subject,
      p_body: body,
      p_reviewed_by: reviewedBy,
    });

    if (rpcError || !draft) {
      setError(rpcError?.message || "Failed to create draft");
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
      setError("Saved, but sending failed -- check n8n. " + (e as Error).message);
      setBusy(false);
      return;
    }

    setBusy(false);
    setSent(true);
    setBody("");
    router.refresh();
  }

  return (
    <div style={{ marginTop: 24, borderTop: "1px solid #eee", paddingTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "#333" }}>Reply as human</div>
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Subject"
        disabled={busy}
        style={{
          width: "100%",
          padding: "8px 10px",
          border: "1px solid #ddd",
          borderRadius: 6,
          fontSize: 14,
          marginBottom: 8,
          fontFamily: "inherit",
        }}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={`Reply to ${toEmail}...`}
        rows={5}
        disabled={busy}
        style={{
          width: "100%",
          padding: 10,
          border: "1px solid #ddd",
          borderRadius: 6,
          fontFamily: "inherit",
          fontSize: 14,
        }}
      />
      {error && <p style={{ color: "crimson", fontSize: 13, marginTop: 8 }}>{error}</p>}
      {sent && !error && <p style={{ color: "#0a7d3a", fontSize: 13, marginTop: 8 }}>Sent.</p>}
      <div style={{ marginTop: 8 }}>
        <button
          onClick={handleSend}
          disabled={busy || !body.trim()}
          style={{
            padding: "8px 16px",
            background: busy || !body.trim() ? "#999" : "#111",
            color: "white",
            border: "none",
            borderRadius: 6,
            cursor: busy || !body.trim() ? "default" : "pointer",
          }}
        >
          {busy ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}
