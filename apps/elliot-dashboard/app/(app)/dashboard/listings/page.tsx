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
import { Image as ImageIcon } from "lucide-react";
import { isPhotoFolderLink, listingPhotos } from "@/lib/listing-photos";
import { resizedPhotoUrl } from "@/lib/google-drive";
import DriveSync from "./drive-sync";
import { Badge, EmptyState, PER_PAGE, PageHeader, Pagination, btn, timeAgo, type Tone } from "../../../_ui/ui";

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
  searchParams: { status?: string; type?: string; q?: string; page?: string };
}) {
  const supabase = createClient();
  const status = LISTING_STATUSES.includes(searchParams.status as ListingStatus) ? searchParams.status : undefined;
  const type = searchParams.type === "sale" || searchParams.type === "rent" ? searchParams.type : undefined;
  const q = (searchParams.q || "").trim();

  // Same filters for the count and for the page of rows.
  const filteredQuery = (columns: string, opts?: { count: "exact"; head?: boolean }) => {
    let qb = supabase.from("listings").select(columns, opts);
    if (status) qb = qb.eq("status", status);
    if (type) qb = qb.eq("transaction_type", type);
    if (q) {
      const like = `%${q.replace(/[%,()]/g, " ")}%`;
      qb = qb.or(`title.ilike.${like},reference.ilike.${like},city.ilike.${like},district.ilike.${like}`);
    }
    return qb;
  };

  // 12 per page, fetched from the database page by page. Count first, so a
  // page number past the end (e.g. after deleting listings) shows the last page.
  const [{ count }, { count: availableCount }, { count: driveFolders }, { count: driveMissing }] = await Promise.all([
    filteredQuery("id", { count: "exact", head: true }),
    supabase.from("listings").select("id", { count: "exact", head: true }).eq("status", "available"),
    // Listings whose link is a Google Drive folder, and those without photos yet.
    supabase.from("listings").select("id", { count: "exact", head: true }).ilike("url", "%drive.google.com%"),
    supabase.from("listings").select("id", { count: "exact", head: true }).ilike("url", "%drive.google.com%").eq("photos", "{}"),
  ]);
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const requested = Math.min(Math.max(1, Number.parseInt(searchParams.page || "1", 10) || 1), pages);
  const offset = (requested - 1) * PER_PAGE;
  const { data: listings, error } = await filteredQuery(
    "id, reference, title, status, transaction_type, property_type, price, currency, city, district, area_m2, rooms, available_from, photos, image_url, url, times_suggested, last_suggested_at, updated_at"
  )
    // Stable order so numbers don't jump between pages: first added = 1.
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + PER_PAGE - 1);

  const filtered = Boolean(status || type || q);
  const today = new Date().toISOString().slice(0, 10);

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
              Import
            </a>
            <a href="/dashboard/listings/new" className={btn.primary}>
              Add listing
            </a>
          </>
        }
      />

      <DriveSync missingCount={driveMissing ?? 0} folderCount={driveFolders ?? 0} />

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
              <a href="/dashboard/listings/import" className={btn.secondary}>Import</a>
              <a href="/dashboard/listings/new" className={btn.primary}>Add listing</a>
            </div>
          </EmptyState>
        )
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full min-w-[900px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-gray-200 text-[12px] text-gray-500">
                <th className="w-10 px-4 py-2.5 font-medium">#</th>
                <th className="w-[112px] py-2.5 font-medium">
                  <span className="sr-only">Photo</span>
                </th>
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
              {(listings ?? []).map((l: any, i: number) => {
                const photos = listingPhotos(l);
                return (
                <tr key={l.id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                  <td className="tabular px-4 py-3 text-[12.5px] text-gray-400">{offset + i + 1}</td>
                  <td className="py-2.5">
                    {photos.length ? (
                      <a href={`/dashboard/listings/${l.id}`} className="relative block h-[72px] w-[96px] overflow-hidden rounded-md bg-gray-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={resizedPhotoUrl(photos[0], 320)} alt="" loading="lazy" className="h-full w-full object-cover" />
                        {photos.length > 1 && (
                          <span className="tabular absolute bottom-1 right-1 rounded bg-ink/80 px-1.5 text-[11px] font-medium text-white">
                            {photos.length}
                          </span>
                        )}
                      </a>
                    ) : isPhotoFolderLink(l.url) ? (
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-[72px] w-[96px] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-gray-300 text-[11.5px] text-gray-500 no-underline hover:border-ink-400 hover:text-ink"
                        title="Photos are in a shared folder. Open the listing to add them here."
                      >
                        <ImageIcon size={16} strokeWidth={1.75} aria-hidden="true" />
                        Photo folder
                      </a>
                    ) : (
                      <a
                        href={`/dashboard/listings/${l.id}`}
                        className="flex h-[72px] w-[96px] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-gray-300 text-[11.5px] text-gray-400 no-underline hover:border-ink-400 hover:text-ink"
                      >
                        <ImageIcon size={16} strokeWidth={1.75} aria-hidden="true" />
                        Add photos
                      </a>
                    )}
                  </td>
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
                    {l.status === "available" && l.available_from && l.available_from > today && (
                      <div className="mt-0.5 text-[12px] text-gray-500">
                        from {new Date(`${l.available_from}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
                      </div>
                    )}
                  </td>
                  <td className="tabular px-4 py-3 text-right">
                    <span className="text-ink">{l.times_suggested}</span>
                    {l.last_suggested_at && <div className="text-[12px] text-gray-500">last {timeAgo(l.last_suggested_at)}</div>}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        page={requested}
        pages={pages}
        total={total}
        offset={offset}
        shown={(listings ?? []).length}
        basePath="/dashboard/listings"
        params={{ status, type, q: q || undefined }}
        noun="listings"
      />
    </div>
  );
}
