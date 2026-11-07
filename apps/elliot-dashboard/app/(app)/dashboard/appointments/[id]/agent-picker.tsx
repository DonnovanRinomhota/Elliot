"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { personName, type TeamMember } from "@/lib/appointments";

// Who is doing the viewing. Saves as soon as it's changed.
export default function AgentPicker({ appointmentId, agentId, team }: { appointmentId: string; agentId: string | null; team: TeamMember[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [value, setValue] = useState(agentId ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save(next: string) {
    setValue(next);
    setState("saving");
    setError(null);
    const { error: e } = await supabase.from("appointments").update({ agent_id: next || null }).eq("id", appointmentId);
    if (e) {
      setState("idle");
      setValue(agentId ?? "");
      return setError(e.message);
    }
    setState("saved");
    router.refresh();
  }

  return (
    <div className="grid gap-1.5">
      <label htmlFor="agent" className="text-[12.5px] font-medium text-gray-600">
        Agent doing the viewing
      </label>
      <select id="agent" value={value} onChange={(e) => save(e.target.value)} disabled={state === "saving"} className="h-9 w-full px-3">
        <option value="">Nobody yet</option>
        {team.map((m) => (
          <option key={m.id} value={m.id}>
            {personName(m)}
            {m.role === "admin" ? " (admin)" : ""}
          </option>
        ))}
      </select>
      <p className="m-0 min-h-[18px] text-[12px] text-gray-500" role="status">
        {state === "saving" ? "Saving…" : state === "saved" ? "Saved." : ""}
      </p>
      {error && (
        <p className="m-0 text-[13px] text-alert" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
