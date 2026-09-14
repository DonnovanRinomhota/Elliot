import { createClient } from "@/lib/supabase/server";
import EscalationCard from "./escalation-card";

export default async function EscalationsPage() {
  const supabase = createClient();

  const { data: escalations, error } = await supabase
    .from("escalations")
    .select("id, conversation_id, reason, priority, context_summary, status, created_at, resolved_at")
    .order("created_at", { ascending: false });

  if (error) {
    return <p style={{ color: "crimson" }}>Failed to load escalations: {error.message}</p>;
  }

  const open = escalations?.filter((e) => e.status !== "resolved") ?? [];
  const resolved = escalations?.filter((e) => e.status === "resolved") ?? [];

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Escalations</h1>
      <p style={{ color: "#666", marginBottom: 24, fontSize: 14 }}>
        {open.length} open, {resolved.length} resolved
      </p>

      {open.length === 0 && resolved.length === 0 && <p style={{ color: "#999" }}>No escalations yet.</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {open.map((escalation: any) => (
          <EscalationCard key={escalation.id} escalation={escalation} />
        ))}
      </div>

      {resolved.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, marginTop: 32, marginBottom: 12, color: "#666" }}>Resolved</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {resolved.map((escalation: any) => (
              <EscalationCard key={escalation.id} escalation={escalation} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
