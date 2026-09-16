import { createClient } from "@/lib/supabase/server";
import ReplyForm from "./reply-form";

export default async function ConversationDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .select("id, channel, status, created_at, contact:contacts(id, name, email, phone)")
    .eq("id", params.id)
    .single();

  const { data: messages, error: msgError } = await supabase
    .from("messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", params.id)
    .order("created_at", { ascending: true });

  if (convError || !conversation) {
    return <p style={{ color: "crimson" }}>Failed to load conversation: {convError?.message}</p>;
  }

  // Supabase returns `contact` as a single object at runtime (conversations.contact_id
  // is a many-to-one FK to contacts), but without generated Database types, postgrest-js
  // can't infer the cardinality from the select string and types it as an array. Assert
  // the real runtime shape here rather than indexing into it as an array.
  const contact = conversation.contact as unknown as {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;

  // "Reply as human" only makes sense where a reply can actually be delivered
  // somewhere real. chat_widget conversations are still one-shot request/
  // response (the widget itself is built -- apps/web-chat-widget -- but the
  // chat webhook has no persistent connection for a human reply to interrupt),
  // so a dashboard reply there would silently go nowhere. Email is async and
  // has a real send pipeline (workflow 17 -> 15), so that's the only channel
  // this supports today. See KNOWN_ISSUES.md.
  const canReplyAsHuman = conversation.channel === "email" && !!contact?.email;

  const ROLE_LABEL: Record<string, string> = {
    user: "user",
    assistant: "elliot",
    human_agent: "you (human)",
    system: "system",
  };

  return (
    <div>
      <a href="/dashboard/conversations" style={{ fontSize: 13, color: "#666" }}>
        &larr; Back to conversations
      </a>

      <h1 style={{ fontSize: 22, margin: "8px 0 4px" }}>
        {contact?.name || contact?.email || "Unknown contact"}
      </h1>
      <p style={{ color: "#666", marginBottom: 24, fontSize: 14 }}>
        {conversation.channel} · {conversation.status} · {contact?.email}
      </p>

      {msgError && <p style={{ color: "crimson" }}>Failed to load messages: {msgError.message}</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {messages?.map((m: any) => {
          const isOutbound = m.role === "assistant" || m.role === "human_agent";
          const isHuman = m.role === "human_agent";
          return (
            <div
              key={m.id}
              style={{
                alignSelf: isOutbound ? "flex-end" : "flex-start",
                maxWidth: "70%",
                background: isHuman ? "#0a7d3a" : isOutbound ? "#111" : "white",
                color: isOutbound ? "white" : "#111",
                border: isOutbound ? "none" : "1px solid #eee",
                borderRadius: 10,
                padding: "10px 14px",
              }}
            >
              <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>
                {ROLE_LABEL[m.role] || m.role}
              </div>
              <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{m.content}</div>
            </div>
          );
        })}
        {(!messages || messages.length === 0) && !msgError && (
          <p style={{ color: "#999" }}>No messages in this conversation.</p>
        )}
      </div>

      {canReplyAsHuman && (
        <ReplyForm
          conversationId={conversation.id}
          contactId={contact!.id}
          toEmail={contact!.email!}
          defaultSubject=""
        />
      )}
      {!canReplyAsHuman && conversation.channel !== "email" && (
        <p style={{ marginTop: 24, fontSize: 12, color: "#999", borderTop: "1px solid #eee", paddingTop: 16 }}>
          Replying from the dashboard isn&apos;t available on {conversation.channel} conversations yet -- there&apos;s
          no live channel to deliver it through.
        </p>
      )}
    </div>
  );
}
