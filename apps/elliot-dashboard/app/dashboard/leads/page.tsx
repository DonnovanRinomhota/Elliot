import { createClient } from "@/lib/supabase/server";
import LeadCard from "./lead-card";

export default async function LeadsPage() {
  const supabase = createClient();

  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, status, score, qualification_answers, created_at, contact:contacts(name, email, phone)")
    .order("created_at", { ascending: false });

  if (error) {
    return <p style={{ color: "crimson" }}>Failed to load leads: {error.message}</p>;
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Leads</h1>
      <p style={{ color: "#666", marginBottom: 24, fontSize: 14 }}>
        {leads?.length ?? 0} lead{leads?.length === 1 ? "" : "s"}
      </p>

      {(!leads || leads.length === 0) && <p style={{ color: "#999" }}>No leads yet.</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {leads?.map((lead: any) => (
          <LeadCard key={lead.id} lead={lead} />
        ))}
      </div>
    </div>
  );
}
