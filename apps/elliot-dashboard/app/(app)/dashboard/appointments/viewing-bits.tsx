// Small pieces shared by the Appointments list, its calendar view and the
// Calendar page. No hooks, so server and client components can both use them.
import { Home, Image as ImageIcon } from "lucide-react";
import { listingPhotos } from "@/lib/listing-photos";
import { resizedPhotoUrl } from "@/lib/google-drive";
import { listingAddress, shortName, timeOf, type ApptListing, type Appointment } from "@/lib/appointments";

/** Cover photo of the listing being viewed, or a plain placeholder. */
export function ListingThumb({ listing, className = "h-11 w-14" }: { listing: ApptListing | null; className?: string }) {
  const cover = listing ? listingPhotos(listing)[0] : undefined;
  if (!cover) {
    return (
      <span className={`flex flex-shrink-0 items-center justify-center rounded bg-gray-100 text-gray-400 ${className}`} aria-hidden="true">
        <ImageIcon size={14} strokeWidth={1.75} />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={resizedPhotoUrl(cover, 240)} alt="" loading="lazy" className={`flex-shrink-0 rounded bg-gray-100 object-cover ${className}`} />
  );
}

/** Thumbnail + title + address, or a prompt to pick the property. */
export function ListingLine({ appointment }: { appointment: Pick<Appointment, "listing" | "notes" | "kind" | "location"> }) {
  const l = appointment.listing;
  // 0043: a valuation visit is at the client's own property, not a listing.
  if (appointment.kind === "valuation") {
    return (
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-11 w-14 flex-shrink-0 items-center justify-center rounded bg-brass-soft text-brass-dark" aria-hidden="true">
          <Home size={15} strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] text-ink">Valuation visit</div>
          <div className="truncate text-[12.5px] text-gray-500">{appointment.location || "Address not given"}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-3">
      <ListingThumb listing={l} />
      <div className="min-w-0">
        {l ? (
          <>
            <div className="truncate text-[13.5px] text-ink">
              {l.title}
              {l.reference && <span className="text-gray-400"> · {l.reference}</span>}
            </div>
            <div className="truncate text-[12.5px] text-gray-500">{listingAddress(l) || "No address on the listing"}</div>
          </>
        ) : (
          <>
            <div className="text-[13px] text-gray-500">Property not set</div>
            {appointment.notes && <div className="truncate text-[12.5px] text-gray-500">{appointment.notes}</div>}
          </>
        )}
      </div>
    </div>
  );
}

const CHIP_TONE: Record<string, string> = {
  confirmed: "border-accent/20 bg-accent-soft text-accent-dark",
  rescheduled: "border-brass/30 bg-brass-soft text-brass-dark",
  completed: "border-gray-200 bg-gray-50 text-gray-600",
  no_show: "border-alert/20 bg-alert-soft text-alert",
  cancelled: "border-gray-200 bg-white text-gray-400 line-through",
};

/** One viewing in a calendar cell: time, client, and (if there's room) the property. */
export function ViewingChip({
  appointment,
  tz,
  showListing = false,
  showAgent = false,
}: {
  appointment: Appointment;
  tz: string;
  showListing?: boolean;
  showAgent?: boolean;
}) {
  const a = appointment;
  const client = shortName(a.contact?.name || a.contact?.email);
  return (
    <a
      href={`/dashboard/appointments/${a.id}`}
      className={`block rounded border px-1.5 py-1 text-[12px] leading-snug no-underline hover:border-ink-400 ${CHIP_TONE[a.status] ?? CHIP_TONE.confirmed}`}
      title={[timeOf(a.starts_at, tz), a.contact?.name || a.contact?.email, a.listing?.title].filter(Boolean).join(" · ")}
    >
      <span className="tabular font-medium">{timeOf(a.starts_at, tz)}</span> <span>{client}</span>
      {showListing && (
        <span className="mt-0.5 block truncate text-[11.5px] opacity-80">
          {a.kind === "valuation" ? "Valuation" : a.listing ? a.listing.district || a.listing.title : "Property not set"}
        </span>
      )}
      {showAgent && !a.agent && <span className="mt-0.5 block text-[11.5px] font-medium text-brass-dark">Unassigned</span>}
    </a>
  );
}
