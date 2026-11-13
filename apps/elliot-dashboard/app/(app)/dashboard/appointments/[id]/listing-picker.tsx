"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { listingAddress, type ApptListing } from "@/lib/appointments";
import { btn } from "../../../../_ui/ui";
import { ListingThumb } from "../viewing-bits";

const COLUMNS = "id, title, reference, address, district, city, photos, image_url, url, price, currency, transaction_type, rooms, area_m2, floor";

// Search the agency's listings and set (or change) which one a viewing is for.
export default function ListingPicker({
  appointmentId,
  currentId,
  onDone,
}: {
  appointmentId: string;
  currentId: string | null;
  onDone?: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ApptListing[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim().replace(/[%,()]/g, " ");
    const t = setTimeout(async () => {
      let qb = supabase.from("listings").select(COLUMNS).order("status").order("title").limit(8);
      if (term) {
        const like = `%${term}%`;
        qb = qb.or(`title.ilike.${like},reference.ilike.${like},address.ilike.${like},district.ilike.${like},city.ilike.${like}`);
      }
      const { data, error: e } = await qb;
      if (e) setError(e.message);
      else setResults((data ?? []) as unknown as ApptListing[]);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function choose(listingId: string | null) {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.from("appointments").update({ listing_id: listingId }).eq("id", appointmentId);
    setBusy(false);
    if (e) return setError(e.message);
    onDone?.();
    router.refresh();
  }

  return (
    <div className="grid gap-3">
      <label htmlFor="listing-search" className="sr-only">
        Search listings
      </label>
      <input
        id="listing-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by title, reference, street or area"
        className="h-9 w-full px-3"
        autoFocus
      />
      <ul className="m-0 grid list-none gap-1 p-0">
        {results === null && <li className="px-2 py-2 text-[13px] text-gray-500">Loading listings…</li>}
        {(results ?? []).map((l) => (
          <li key={l.id}>
            <button
              type="button"
              onClick={() => choose(l.id)}
              disabled={busy || l.id === currentId}
              className="flex w-full items-center gap-3 rounded-md border border-transparent px-2 py-1.5 text-left hover:border-gray-200 hover:bg-glass-hi disabled:opacity-60"
            >
              <ListingThumb listing={l} className="h-10 w-12" />
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] text-ink">
                  {l.title}
                  {l.reference && <span className="text-gray-400"> · {l.reference}</span>}
                  {l.id === currentId && <span className="text-gray-500"> (current)</span>}
                </span>
                <span className="block truncate text-[12.5px] text-gray-500">{listingAddress(l) || "No address"}</span>
              </span>
            </button>
          </li>
        ))}
        {results !== null && results.length === 0 && (
          <li className="px-2 py-2 text-[13px] text-gray-500">{q.trim() ? "No listings match." : "No listings yet. Add them in Listings."}</li>
        )}
      </ul>
      <div className="flex flex-wrap gap-2">
        {currentId && (
          <button type="button" onClick={() => choose(null)} disabled={busy} className={`${btn.ghost} ${btn.small}`}>
            Not about one property
          </button>
        )}
        {onDone && (
          <button type="button" onClick={onDone} className={`${btn.ghost} ${btn.small}`}>
            Close
          </button>
        )}
      </div>
      {error && (
        <p className="m-0 text-[13px] text-alert" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
