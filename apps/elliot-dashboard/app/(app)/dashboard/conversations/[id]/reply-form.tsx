"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { btn } from "../../../../_ui/ui";

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

    // Sent via the dashboard's server, which adds the n8n webhook secret --
    // see app/api/drafts/[id]/send/route.ts.
    try {
      const res = await fetch(`/api/drafts/${draft.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "email" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || `Send returned ${res.status}`);
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
    <section className="mt-6 rounded-lg border border-gray-200 bg-white">
      <h2 className="m-0 border-b border-gray-200 px-5 py-3.5 text-[14px] font-semibold text-ink">Reply yourself</h2>
      <div className="grid gap-3 p-5">
        <p className="m-0 text-[13px] text-gray-500">
          Sends an email to <span className="text-ink">{toEmail}</span> from your connected inbox, as you rather than Elliot.
        </p>
        <div>
          <label htmlFor="reply-subject" className="mb-1 block text-[12.5px] font-medium text-gray-600">
            Subject
          </label>
          <input id="reply-subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={busy} className="h-9 w-full px-3" />
        </div>
        <div>
          <label htmlFor="reply-body" className="mb-1 block text-[12.5px] font-medium text-gray-600">
            Message
          </label>
          <textarea
            id="reply-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            disabled={busy}
            className="w-full p-3 leading-relaxed"
          />
        </div>
        {error && (
          <p className="m-0 text-[13px] text-alert" role="alert">
            {error}
          </p>
        )}
        {sent && !error && <p className="m-0 text-[13px] text-ink">Sent.</p>}
        <div>
          <button type="button" onClick={handleSend} disabled={busy || !body.trim()} className={btn.primary}>
            {busy ? "Sending…" : "Send reply"}
          </button>
        </div>
      </div>
    </section>
  );
}
