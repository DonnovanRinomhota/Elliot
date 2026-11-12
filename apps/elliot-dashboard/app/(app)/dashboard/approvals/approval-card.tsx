"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Pencil, Sparkles } from "lucide-react";
import { ChannelTile } from "../../../_ui/brands";
import { StatusBadge, btn, humanize } from "../../../_ui/ui";

// channel decides which table/RPC/send workflow this card talks to --
// email_drafts + approve_email_draft() + workflow 17, or whatsapp_drafts +
// approve_whatsapp_draft() + workflow 28 (both reached through
// /api/drafts/[id]/send). Two sibling tables, not one -- see migration
// 0025's header comment for why.
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
  /** whatsapp only (0045): why WhatsApp refused it. */
  send_error?: string | null;
  created_at: string;
  conversation_id?: string | null;
  /** [label, date] steps, e.g. [["Received", "9 Nov 2026, 17:01"], ["Drafted", ...], ["Sent", ...]]. */
  timeline?: [string, string][];
  /** The client's message this draft answers. */
  inbound?: { content: string; at: string } | null;
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

    // Sent via the dashboard's server, which checks the draft is this
    // tenant's and approved, then calls n8n with the webhook secret -- see
    // app/api/drafts/[id]/send/route.ts.
    try {
      const res = await fetch(`/api/drafts/${draft.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: isWhatsapp ? "whatsapp" : "email" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || `Send returned ${res.status}`);
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

  const confidence = Number(draft.confidence);
  const pct = Number.isFinite(confidence) ? Math.round(confidence <= 1 ? confidence * 100 : confidence) : null;
  const recipient = isWhatsapp ? draft.to_wa_id : draft.to_email;
  const isPending = draft.status === "pending";
  const isSpam = draft.category === "spam";

  return (
    <article className={`card flex flex-col p-5 ${isPending ? "" : "opacity-90"}`}>
      <header className="flex items-start gap-3">
        <ChannelTile channel={draft.channel} size={38} />
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-[15px] font-semibold text-ink">{isWhatsapp ? "WhatsApp reply" : draft.subject || "(no subject)"}</h2>
          <p className="m-0 mt-0.5 truncate text-[12.5px] text-gray-500">
            To <span className="text-ink">{recipient}</span>
          </p>
          {draft.timeline && draft.timeline.length > 0 && (
            <dl className="m-0 mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px]">
              {draft.timeline.map(([label, at]) => (
                <div key={label} className="flex gap-1.5">
                  <dt className="text-gray-500">{label}</dt>
                  <dd className="tabular m-0 text-ink">{at}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <span className="flex flex-shrink-0 flex-col items-end gap-1.5">
          <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${isSpam ? "bg-gray-100 text-gray-600" : "bg-brass-soft text-brass-dark"}`}>
            {isSpam ? "Spam or automatic" : humanize(draft.category)}
          </span>
          {!isPending && <StatusBadge kind="draft" value={draft.status} />}
        </span>
      </header>

      <div className={`mt-4 grid gap-3 ${draft.inbound && !isEditing ? "md:grid-cols-2" : ""}`}>
        {draft.inbound && !isEditing && (
          <div className="min-w-0 rounded-2xl border border-[rgba(15,31,56,0.06)] bg-[#f3f6fb] px-4 py-3">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-[12px] text-gray-500">
              <span className="font-semibold text-gray-700">Client wrote · {draft.inbound.at}</span>
              {draft.conversation_id && (
                <a href={`/dashboard/conversations/${draft.conversation_id}`} className="text-ink-600 underline">
                  Open conversation
                </a>
              )}
            </div>
            <p className="m-0 line-clamp-6 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-gray-700">{draft.inbound.content.trim() || "(empty message)"}</p>
          </div>
        )}
        <div className="min-w-0 rounded-2xl border border-gold/45 bg-white px-4 py-3 shadow-[0_12px_26px_-20px_rgba(185,126,71,0.8)]">
          <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-brass-dark">
            <Sparkles size={12} aria-hidden="true" />
            {isPending ? "Elliot's reply" : "Reply"}
          </div>
          {isEditing ? (
            <>
              <label htmlFor={`body-${draft.id}`} className="sr-only">
                Edit the message before sending
              </label>
              <textarea
                id={`body-${draft.id}`}
                value={editedBody}
                onChange={(e) => setEditedBody(e.target.value)}
                rows={9}
                className="w-full p-3 leading-relaxed"
              />
            </>
          ) : (
            <p className="m-0 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-gray-800">{draft.body}</p>
          )}
        </div>
      </div>

      {error && (
        <p className="mb-0 mt-3 text-[13px] text-alert" role="alert">
          {error}
        </p>
      )}

      {draft.status === "blocked_needs_template" && (
        <p className="mb-0 mt-3 rounded-xl bg-alert-soft px-3 py-2 text-[13px] text-alert-dark">
          {draft.send_error ? (
            <>Not sent: WhatsApp refused it. {draft.send_error}</>
          ) : (
            <>
              Not sent: more than 24 hours have passed since this contact last wrote on WhatsApp, and WhatsApp only
              allows a free-form reply within 24 hours. Reply from the conversation once they write again, or by email.
            </>
          )}
        </p>
      )}

      <footer className="mt-4 flex flex-wrap items-center gap-2">
        {pct != null && (
          <span className="mr-auto flex items-center gap-2 text-[12.5px] text-gray-500">
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
              <span className="gold-fill block h-full rounded-full" style={{ width: `${pct}%` }} />
            </span>
            {pct}% sure
          </span>
        )}
        {isPending ? (
          isSpam && !isEditing ? (
            <>
              <button type="button" onClick={handleApprove} disabled={busy} className={btn.secondary}>
                Send anyway
              </button>
              <button type="button" onClick={handleReject} disabled={busy} className={btn.primary}>
                Reject
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setIsEditing((v) => !v)} disabled={busy} className={btn.secondary}>
                {isEditing ? "Discard edits" : (
                  <>
                    <Pencil size={14} aria-hidden="true" /> Edit
                  </>
                )}
              </button>
              <button type="button" onClick={handleReject} disabled={busy} className={btn.danger}>
                Reject
              </button>
              <button type="button" onClick={handleApprove} disabled={busy} className={btn.primary}>
                {isEditing ? "Save and send" : "Approve and send"}
              </button>
            </>
          )
        ) : (
          draft.status !== "blocked_needs_template" && (
            <span className="text-[12.5px] text-gray-500">
              {draft.status === "auto_sent" ? "Sent automatically, no review needed." : `${humanize(draft.status)}. Nothing more to do.`}
            </span>
          )
        )}
      </footer>
    </article>
  );
}
