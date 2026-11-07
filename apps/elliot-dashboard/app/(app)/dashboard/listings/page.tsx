import { createClient } from "@/lib/supabase/server";
import {
  LISTING_STATUSES,
  PROPERTY_LABEL,
  STATUS_LABEL,
  TRANSACTION_LABEL,
  formatPrice,
  type ListingStatus,
  type PropertyType,
  type TransactionType,
} from "@/lib/listings";
import { Badge, EmptyState, PageHeader, btn, timeAgo, type Tone } from "../../../_ui/ui";

const STATUS_TONE: Record<ListingStatus, Tone> = {
  available: "ink",
  under_offer: "brass",
  sold: "muted",
  let: "muted",
  withdrawn: "muted",
};

export default async function ListingsPage({
  searchParams,
}: {
  searchParams: { status?: string; type?: string; q?: string };
}) {
  const supabase = createClient();
  const status = LISTING_STATUSES.includes(searchParams.status as ListingStatus) ? searchParams.status : undefined;
  const type = searchParams.type === "sale" || searchParams.type === "rent" ? searchParams.type : undefined;
  const q = (searchParams.q || "").trim();

  let query = supabase
    .from("listings")
    .select(
      "id, reference, title, status, transaction_type, property_type, price, currency, city, district, area_m2, rooms, times_suggested, last_suggested_at, updated_at"
    )
    .order("updated_at", { ascending: false })
    .limit(500);
  if (status) query = query.eq("status", status);
  if (type) query = query.eq("transaction_type", type);
  if (q) {
    const like = `%${q.replace(/[%,()]/g, " ")}%`;
    query = query.or(`title.ilike.${like},reference.ilike.${like},city.ilike.${like},district.ilike.${like}`);
  }
  const [{ data: listings, error }, { count: availableCount }] = await Promise.all([
    query,
    supabase.from("listings").select("id", { count: "exact", head: true }).eq("status", "available"),
  ]);

  const filtered = Boolean(status || type || q);

  return (
    <div>
      <PageHeader
        title="Listings"
        description={
          <>
            The properties Elliot can offer. It only ever suggests listings marked Available, and never makes one up.{" "}
            {availableCount != null && (
              <span className="text-ink">
                {availableCount} available now.
              </span>
            )}
          </>
        }
        actions={
          <>
            <a href="/dashboard/listings/import" className={btn.secondary}>
              Import CSV
            </a>
            <a href="/dashboard/listings/new" className={btn.primary}>
              Add listing
            </a>
          </>
        }
      />

      <form className="mb-4 flex flex-wrap gap-2" action="/dashboard/listings">
        <label className="sr-only" htmlFor="l-q">Search</label>
        <input id="l-q" name="q" defaultValue={q} placeholder="Search title, reference or area" className="h-9 min-w-[220px] flex-1 px-3" />
        <label className="sr-only" htmlFor="l-status">Status</label>
        <select id="l-status" name="status" defaultValue={status ?? ""} className="h-9 px-3">
          <option value="">Any status</option>
          {LISTING_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="l-type">Sale or rent</label>
        <select id="l-type" name="type" defaultValue={type ?? ""} className="h-9 px-3">
          <option value="">Sale and rent</option>
          <option value="sale">For sale</option>
          <option value="rent">For rent</option>
        </select>
        <button type="submit" className={btn.secondary}>Filter</button>
        {filtered && (
          <a href="/dashboard/listings" className={btn.ghost}>Clear</a>
        )}
      </form>

      {error && <p className="mb-4 text-[13px] text-alert">Couldn&apos;t load listings: {error.message}</p>}

      {!error && (listings ?? []).length === 0 ? (
        filtered ? (
          <EmptyState title="No listings match">Try a different search or filter.</EmptyState>
        ) : (
          <EmptyState title="No listings yet">
            Add your properties one by one, or import them all from a spreadsheet. Once they&apos;re here, Elliot can answer
            &ldquo;what do you have in Mokotów under 900k?&rdquo; with your real listings.
            <div className="mt-4 flex justify-center gap-2">
              <a href="/dashboard/listings/import" className={btn.secondary}>Import CSV</a>
              <a href="/dashboard/listings/new" className={btn.primary}>Add listing</a>
            </div>
          </EmptyState>
        )
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full min-w-[820px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-gray-200 text-[12px] text-gray-500">
                <th className="px-4 py-2.5 font-medium">Listing</th>
                <th className="px-4 py-2.5 font-medium">Price</th>
                <th className="px-4 py-2.5 font-medium">Location</th>
                <th className="px-4 py-2.5 font-medium">Size</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium" title="How many times Elliot has suggested this listing in a chat">
                  Suggested
                </th>
              </tr>
            </thead>
            <tbody>
              {(listings ?? []).map((l: any) => (
                <tr key={l.id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <a href={`/dashboard/listings/${l.id}`} className="font-medium text-ink no-underline hover:underline">
                      {l.title}
                    </a>
                    <div className="text-[12px] text-gray-500">
                      {[l.reference && `Ref ${l.reference}`, PROPERTY_LABEL[l.property_type as PropertyType], TRANSACTION_LABEL[l.transaction_type as TransactionType]]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </td>
                  <td className="tabular whitespace-nowrap px-4 py-3 text-ink">{formatPrice(l.price, l.currency, l.transaction_type)}</td>
                  <td className="px-4 py-3 text-gray-700">{[l.district, l.city].filter(Boolean).join(", ") || "–"}</td>
                  <td className="tabular whitespace-nowrap px-4 py-3 text-gray-700">
                    {[l.area_m2 && `${Number(l.area_m2)} m²`, l.rooms && `${l.rooms} room${l.rooms === 1 ? "" : "s"}`].filter(Boolean).join(", ") || "–"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[l.status as ListingStatus]}>{STATUS_LABEL[l.status as ListingStatus]}</Badge>
                  </td>
                  <td className="tabular px-4 py-3 text-right">
                    <span className="text-ink">{l.times_suggested}</span>
                    {l.last_suggested_at && <div className="text-[12px] text-gray-500">last {timeAgo(l.last_suggested_at)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
