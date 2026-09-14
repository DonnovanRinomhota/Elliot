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

// Real values confirmed via leads_status_check constraint.
const STATUS_OPTIONS = ["NEW", "QUALIFYING", "HOT", "WARM", "COLD", "CONVERTED", "LOST"];
const CLOSED_STATUSES = ["CONVERTED", "LOST"];

const STATUS_STYLES: Record<string, string> = {
  HOT: "bg-coral-soft text-coral-dark",
  WARM: "bg-amber-soft text-amber-dark",
  COLD: "bg-gray-100 text-gray-600",
  NEW: "bg-blue-50 text-blue-700",
  QUALIFYING: "bg-blue-50 text-blue-700",
  CONVERTED: "bg-pulse-soft text-pulse-dark",
  LOST: "bg-gray-100 text-gray-500",
};

export default function LeadCard({ lead }: { lead: Lead }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isClosed = CLOSED_STATUSES.includes(lead.status);

  async function updateStatus(newStatus: string) {
    setBusy(true);
    setError(null);

    const { error: updateError } = await supabase.from("leads").update({ status: newStatus }).eq("id", lead.id);

    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className={`rounded-xl border border-gray-200 bg-white p-5 ${isClosed ? "opacity-70" : ""}`}>
      <div className="mb-2 flex items-start justify-between">
        <div>
          <span className="font-medium">{lead.contact?.name || lead.contact?.email || "Unknown contact"}</span>
          <span className="ml-2 text-xs text-gray-400">
            {lead.contact?.email} {lead.contact?.phone ? `· ${lead.contact.phone}` : ""}
          </span>
        </div>
        <span className="text-xs text-gray-400">
          {new Date(lead.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </span>
      </div>

      <div className="mb-3 flex items-center gap-3 text-xs">
        <span className={`rounded-md px-2 py-0.5 font-medium ${STATUS_STYLES[lead.status] || "bg-gray-100 text-gray-600"}`}>
          {lead.status}
        </span>
        {lead.score != null && <span className="text-gray-500">Score: {lead.score}</span>}
      </div>

      {lead.qualification_answers && Object.keys(lead.qualification_answers).length > 0 && (
        <pre className="mb-3 overflow-x-auto rounded-md bg-gray-50 p-2.5 text-xs">
          {JSON.stringify(lead.qualification_answers, null, 2)}
        </pre>
      )}

      {error && <p className="mb-2 text-xs text-red-700">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.filter((s) => s !== lead.status).map((s) => (
          <button
            key={s}
            onClick={() => updateStatus(s)}
            disabled={busy}
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50"
          >
            Mark {s}
          </button>
        ))}
      </div>
    </div>
  );
}
