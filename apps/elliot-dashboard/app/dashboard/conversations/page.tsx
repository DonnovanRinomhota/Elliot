import { createClient } from "@/lib/supabase/server";

export default async function ConversationsPage() {
  const supabase = createClient();

  const { data: conversations, error } = await supabase
    .from("conversations")
    .select("id, channel, status, created_at, contact:contacts(name, email)")
    .order("created_at", { ascending: false });

  if (error) {
    return <p style={{ color: "crimson" }}>Failed to load conversations: {error.message}</p>;
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Conversations</h1>
      <p style={{ color: "#666", marginBottom: 24, fontSize: 14 }}>
        {conversations?.length ?? 0} conversation{conversations?.length === 1 ? "" : "s"}
      </p>

      {(!conversations || conversations.length === 0) && <p style={{ color: "#999" }}>No conversations yet.</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {conversations?.map((c: any) => (
          <a
            key={c.id}
            href={`/dashboard/conversations/${c.id}`}
            style={{
              display: "flex",
              justifyContent: "space-between",
              background: "white",
              border: "1px solid #eee",
              borderRadius: 10,
              padding: "14px 20px",
              textDecoration: "none",
              color: "#111",
            }}
          >
            <div>
              <strong>{c.contact?.name || c.contact?.email || "Unknown contact"}</strong>
              <span style={{ marginLeft: 8, fontSize: 12, color: "#999" }}>
                {c.channel} · {c.status}
              </span>
            </div>
            <span style={{ fontSize: 12, color: "#999" }}>
              {new Date(c.created_at).toLocaleString("en-GB", { timeZone: "UTC" })}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
