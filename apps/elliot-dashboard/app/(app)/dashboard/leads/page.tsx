import { createClient } from "@/lib/supabase/server";
import LeadCard from "./lead-card";

// CONVERTED/LOST are the only "closed" states in the schema's check
// constraint -- everything else (NEW/QUALIFYING/HOT/WARM/COLD) is still
// open. Closed leads stay fully visible here, not archived away, since the
// whole point is being able to find and reopen one later.
const CLOSED_STATUSES = ["CONVERTED", "LOST"];

export default async function LeadsPage() {
  const supabase = createClient();

  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, status, score, qualification_answers, created_at, contact:contacts(name, email, phone)")
    .order("created_at", { ascending: false });

  if (error) {
    return <p className="text-sm text-red-700">Failed to load leads: {error.message}</p>;
  }

  const open = (leads ?? []).filter((l: any) => !CLOSED_STATUSES.includes(l.status));
  const closed = (leads ?? []).filter((l: any) => CLOSED_STATUSES.includes(l.status));

  return (
    <div>
      <h1 className="mb-1 text-xl font-medium">Leads</h1>
      <p className="mb-6 text-sm text-gray-500">
        {open.length} open, {closed.length} closed
      </p>

      {leads?.length === 0 && <p className="text-sm text-gray-400">No leads yet.</p>}

      <div className="flex flex-col gap-3">
        {open.map((lead: any) => (
          <LeadCard key={lead.id} lead={lead} />
        ))}
      </div>

      {closed.length > 0 && (
        <>
          <div className="mb-3 mt-8 text-sm font-medium text-gray-500">Closed</div>
          <div className="flex flex-col gap-3">
            {closed.map((lead: any) => (
              <LeadCard key={lead.id} lead={lead} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
