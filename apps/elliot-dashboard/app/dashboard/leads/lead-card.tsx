"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Lead = {
  id: string;
  status: string;
  score: number | string | null;
  qualification_answers: Record<string, unknown> | null;
  created_at: string;
  contact: { name: string | null; email: string | null; phone: string | null } | null;
};

// Real values confirmed via leads_status_check constraint -- uppercase, and
// this specific set only (not the generic new/contacted/qualified/lost guess
// used originally).
const STATUS_OPTIONS = ["NEW", "QUALIFYING", "HOT", "WARM", "COLD", "CONVERTED", "LOST"];

export default function LeadCard({ lead }: { lead: Lead }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function updateStatus(newStatus: string) {
    setBusy(true);
    setError(null);

    const { error: updateError } = await supabase
      .from("leads")
      .update({ status: newStatus })
      .eq("id", lead.id);

    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.refresh();
  }

  return (
    <div style={{ background: "white", border: "1px solid #eee", borderRadius: 10, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <div>
          <strong>{lead.contact?.name || lead.contact?.email || "Unknown contact"}</strong>
          <span style={{ marginLeft: 8, fontSize: 12, color: "#999" }}>
            {lead.contact?.email} {lead.contact?.phone ? `· ${lead.contact.phone}` : ""}
          </span>
        </div>
        <span style={{ fontSize: 12, color: "#999" }}>
          {new Date(lead.created_at).toLocaleString("en-GB", { timeZone: "UTC" })}
        </span>
      </div>

      <div style={{ display: "flex", gap: 16, fontSize: 13, color: "#666", marginBottom: 12 }}>
        <span>
          Status: <strong>{lead.status}</strong>
        </span>
        {lead.score != null && <span>Score: {lead.score}</span>}
      </div>

      {lead.qualification_answers && Object.keys(lead.qualification_answers).length > 0 && (
        <pre
          style={{
            background: "#f7f7f8",
            padding: 10,
            borderRadius: 6,
            fontSize: 12,
            overflowX: "auto",
            marginBottom: 12,
          }}
        >
          {JSON.stringify(lead.qualification_answers, null, 2)}
        </pre>
      )}

      {error && <p style={{ color: "crimson", fontSize: 13, marginBottom: 8 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {STATUS_OPTIONS.filter((s) => s !== lead.status).map((s) => (
          <button
            key={s}
            onClick={() => updateStatus(s)}
            disabled={busy}
            style={{ padding: "6px 12px", background: "white", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, cursor: "pointer" }}
          >
            Mark {s}
          </button>
        ))}
      </div>
    </div>
  );
}
