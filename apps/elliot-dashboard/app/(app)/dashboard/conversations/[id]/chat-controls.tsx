"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ErrorText, btn } from "../../../../_ui/ui";
import { timeLeftLabel, whatsappWindow } from "@/lib/whatsapp";

// Live chats (website and WhatsApp): take over from Elliot, reply as
// yourself, hand back. Pinned to the bottom of the screen (see the
// conversation page), so it's always in reach however far up the messages
// you are. Kept compact.
// Website: replies are saved as human_agent messages; the visitor's chat
// window picks them up within a few seconds (it polls /api/widget/messages).
// WhatsApp: replies go through /api/conversations/:id/whatsapp, which sends
// them on WhatsApp (workflow 32) and then saves them.
export default function ChatControls({
  conversationId,
  handledByMe,
  handlerName,
  canTakeOver,
  channel = "chat_widget",
  lastInboundAt = null,
}: {
  conversationId: string;
  handledByMe: boolean;
  handlerName: string | null;
  canTakeOver: boolean;
  channel?: "chat_widget" | "whatsapp" | "email";
  /** WhatsApp only: when the client last wrote (starts the 24-hour reply window). */
  lastInboundAt?: string | null;
}) {
  const onWhatsApp = channel === "whatsapp";
  // Email: taking over only pauses Elliot; you reply with the email form below.
  const onEmail = channel === "email";
  const window24 = onWhatsApp ? whatsappWindow(lastInboundAt) : null;
  const who = onWhatsApp ? "client" : "visitor";
  const router = useRouter();
  const supabase = createClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(fn: string, args: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.rpc(fn, args);
    setBusy(false);
    if (e) {
      setError(e.message);
      return false;
    }
    router.refresh();
    return true;
  }

  async function sendWhatsApp() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.error || `Couldn't send it (HTTP ${res.status}).`);
        return false;
      }
      router.refresh();
      return true;
    } catch (e) {
      setError(`Couldn't send it: ${(e as Error).message}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const ok = onWhatsApp
      ? await sendWhatsApp()
      : await call("send_human_chat_message", { p_conversation_id: conversationId, p_content: text });
    if (ok) setText("");
  }

  const windowClosed = Boolean(window24 && !window24.open);

  if (!handledByMe) {
    return (
      <section className="card px-5 py-3.5 !shadow-[0_-4px_16px_rgba(16,24,40,0.10)]">
        <div className="flex flex-wrap items-center justify-between gap-3 md:flex-nowrap">
          <div className="min-w-0 md:flex-1">
            <h2 className="m-0 text-[14px] font-semibold text-ink">
              {handlerName
                ? `${handlerName} is handling this ${onEmail ? "conversation" : "chat"}`
                : `Elliot is answering this ${onWhatsApp ? "WhatsApp chat" : onEmail ? "email conversation" : "chat"}`}
            </h2>
            <p className="m-0 mt-0.5 text-[13px] text-gray-500">
              {handlerName
                ? "Elliot is paused. You can take it over yourself."
                : onEmail
                  ? "Take over to stop Elliot replying to this client's emails until you hand it back. You reply with the email form below."
                  : onWhatsApp
                  ? "Take over to reply yourself. Elliot stays quiet until you hand it back; the client gets your replies on WhatsApp."
                  : "Take over to reply yourself. Elliot stays quiet until you hand it back; the visitor sees your replies in the same chat window."}
            </p>
          </div>
          {canTakeOver ? (
            <button type="button" disabled={busy} onClick={() => call("take_over_conversation", { p_conversation_id: conversationId })} className={`${btn.primary} shrink-0`}>
              {busy ? "Taking over…" : onEmail ? "Take over" : "Take over this chat"}
            </button>
          ) : (
            <p className="m-0 text-[13px] text-gray-500">Only members of this agency can take over chats.</p>
          )}
        </div>
        {error && <div className="mt-3"><ErrorText>{error}</ErrorText></div>}
      </section>
    );
  }

  if (onEmail) {
    return (
      <section className="rounded-[18px] border border-accent/25 bg-glass px-5 py-3.5 shadow-[0_-4px_16px_rgba(16,24,40,0.10)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="m-0 text-[14px] font-semibold text-ink">You&apos;re handling this conversation. Elliot is paused.</h2>
            <p className="m-0 mt-0.5 text-[13px] text-gray-500">Reply with the email form. Elliot won&apos;t answer this client&apos;s emails until you hand it back.</p>
          </div>
          <button type="button" disabled={busy} onClick={() => call("hand_back_conversation", { p_conversation_id: conversationId })} className={`${btn.secondary} ${btn.small}`}>
            Hand back to Elliot
          </button>
        </div>
        {error && <div className="mt-3"><ErrorText>{error}</ErrorText></div>}
      </section>
    );
  }

  return (
    <section className="rounded-[18px] border border-accent/25 bg-glass shadow-[0_-4px_16px_rgba(16,24,40,0.10)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-2.5">
        <h2 className="m-0 text-[14px] font-semibold text-ink">You&apos;re handling this chat. Elliot is paused.</h2>
        <button type="button" disabled={busy} onClick={() => call("hand_back_conversation", { p_conversation_id: conversationId })} className={`${btn.secondary} ${btn.small}`}>
          Hand back to Elliot
        </button>
      </div>
      <form onSubmit={send} className="grid gap-2.5 px-5 py-3.5">
        <label htmlFor="chat-reply" className="sr-only">
          Your reply
        </label>
        <textarea
          id="chat-reply"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement).requestSubmit();
            }
          }}
          placeholder={windowClosed ? "Replies are closed until the client writes again." : "Type your reply. Enter sends, Shift+Enter for a new line."}
          disabled={busy || windowClosed}
          className="w-full p-3 leading-relaxed"
        />
        {error && <ErrorText>{error}</ErrorText>}
        <div className="flex items-center justify-between gap-3">
          <span className={`text-[12.5px] ${windowClosed ? "text-alert" : "text-gray-500"}`}>
            {!onWhatsApp
              ? `The ${who} sees this in the chat window on your website.`
              : windowClosed
                ? "More than 24 hours since the client last wrote. WhatsApp only allows replies within 24 hours, so wait for them to write again, or call or email them."
                : `Goes to the client on WhatsApp. You can reply for another ${timeLeftLabel(window24!.minutesLeft)}.`}
          </span>
          <button type="submit" disabled={busy || !text.trim() || windowClosed} className={`${btn.primary} shrink-0`}>
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}
