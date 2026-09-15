import { createClient } from "@/lib/supabase/server";

export default async function ConversationDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .select("id, channel, status, created_at, contact:contacts(name, email, phone)")
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
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;

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
        {messages?.map((m: any) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.role === "assistant" ? "flex-end" : "flex-start",
              maxWidth: "70%",
              background: m.role === "assistant" ? "#111" : "white",
              color: m.role === "assistant" ? "white" : "#111",
              border: m.role === "assistant" ? "none" : "1px solid #eee",
              borderRadius: 10,
              padding: "10px 14px",
            }}
          >
            <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>{m.role}</div>
            <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{m.content}</div>
          </div>
        ))}
        {(!messages || messages.length === 0) && !msgError && (
          <p style={{ color: "#999" }}>No messages in this conversation.</p>
        )}
      </div>
    </div>
  );
}
