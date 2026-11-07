"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ErrorText, btn } from "../../../../_ui/ui";

// Live website chat: take over from Elliot, reply as yourself, hand back.
// Pinned to the bottom of the screen (see the conversation page), so it's
// always in reach however far up the messages you are. Kept compact.
// Replies are saved as human_agent messages; the visitor's chat window picks
// them up within a few seconds (it polls /api/widget/messages).
export default function ChatControls({
  conversationId,
  handledByMe,
  handlerName,
  canTakeOver,
}: {
  conversationId: string;
  handledByMe: boolean;
  handlerName: string | null;
  canTakeOver: boolean;
}) {
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

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    if (await call("send_human_chat_message", { p_conversation_id: conversationId, p_content: text })) setText("");
  }

  if (!handledByMe) {
    return (
      <section className="card px-5 py-3.5 !shadow-[0_-4px_16px_rgba(16,24,40,0.10)]">
        <div className="flex flex-wrap items-center justify-between gap-3 md:flex-nowrap">
          <div className="min-w-0 md:flex-1">
            <h2 className="m-0 text-[14px] font-semibold text-ink">
              {handlerName ? `${handlerName} is handling this chat` : "Elliot is answering this chat"}
            </h2>
            <p className="m-0 mt-0.5 text-[13px] text-gray-500">
              {handlerName
                ? "Elliot is paused. You can take it over yourself."
                : "Take over to reply yourself. Elliot stays quiet until you hand it back; the visitor sees your replies in the same chat window."}
            </p>
          </div>
          {canTakeOver ? (
            <button type="button" disabled={busy} onClick={() => call("take_over_conversation", { p_conversation_id: conversationId })} className={`${btn.primary} shrink-0`}>
              {busy ? "Taking over…" : "Take over this chat"}
            </button>
          ) : (
            <p className="m-0 text-[13px] text-gray-500">Only members of this agency can take over chats.</p>
          )}
        </div>
        {error && <div className="mt-3"><ErrorText>{error}</ErrorText></div>}
      </section>
    );
  }

  return (
    <section className="rounded-[18px] border border-accent/25 bg-white shadow-[0_-4px_16px_rgba(16,24,40,0.10)]">
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
          placeholder="Type your reply. Enter sends, Shift+Enter for a new line."
          disabled={busy}
          className="w-full p-3 leading-relaxed"
        />
        {error && <ErrorText>{error}</ErrorText>}
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12.5px] text-gray-500">The visitor sees this in the chat window on your website.</span>
          <button type="submit" disabled={busy || !text.trim()} className={btn.primary}>
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}
