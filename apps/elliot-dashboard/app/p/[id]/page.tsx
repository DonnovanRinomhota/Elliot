// /p/<listing id>: the property page Elliot sends clients when it suggests a
// flat or confirms a viewing, for listings that don't have a page on the
// agency's own website. Public (no sign-in; not in the middleware matcher).
//
// Data comes from public_listing() (migration 0033): only listings that are
// available or under offer, and no internal fields. The page sets Open Graph
// tags, so WhatsApp, Messenger and email show the cover photo in the preview.
import type { Metadata } from "next";
import { BedDouble, Building2, CalendarDays, ExternalLink, Images, MapPin, Ruler } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatPrice } from "@/lib/listings";
import { isPhotoFolderLink, listingPhotos } from "@/lib/listing-photos";
import { resizedPhotoUrl } from "@/lib/google-drive";
import PhotoGallery from "@/app/_ui/photo-gallery";

export const dynamic = "force-dynamic";

type PublicListing = {
  id: string;
  reference: string | null;
  title: string;
  status: string;
  transaction_type: string;
  property_type: string;
  price: number | null;
  currency: string;
  city: string | null;
  district: string | null;
  address: string | null;
  area_m2: number | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor: number | null;
  description: string | null;
  features: string[] | null;
  url: string | null;
  image_url: string | null;
  photos: string[] | null;
  available_from: string | null;
  agency: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getListing(id: string): Promise<PublicListing | null> {
  if (!UUID.test(id)) return null;
  const supabase = createClient();
  const { data, error } = await supabase.rpc("public_listing", { p_listing_id: id });
  if (error || !data) return null;
  return data as PublicListing;
}

const place = (l: PublicListing) => [l.district, l.city].filter(Boolean).join(", ");

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const l = await getListing(params.id);
  if (!l) return { title: "Property not available", robots: { index: false } };
  const photos = listingPhotos(l);
  const description = [formatPrice(l.price, l.currency, l.transaction_type), place(l), l.area_m2 ? `${Number(l.area_m2)} m²` : null]
    .filter(Boolean)
    .join(" · ");
  return {
    title: `${l.title} · ${l.agency}`,
    description,
    robots: { index: false },
    openGraph: {
      title: l.title,
      description,
      siteName: l.agency,
      type: "website",
      images: photos.length ? [{ url: resizedPhotoUrl(photos[0], 1200) }] : undefined,
    },
  };
}

function Fact({ icon: Icon, label, value }: { icon: typeof Ruler; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-gray-200 bg-glass px-3.5 py-2.5">
      <Icon size={17} strokeWidth={1.75} className="flex-shrink-0 text-accent" aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-[11.5px] uppercase tracking-wide text-gray-500">{label}</div>
        <div className="truncate text-[14.5px] font-medium text-ink">{value}</div>
      </div>
    </div>
  );
}

export default async function PublicListingPage({ params }: { params: { id: string } }) {
  const l = await getListing(params.id);

  if (!l) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="card max-w-md px-7 py-8 text-center">
          <h1 className="m-0 text-[20px] font-semibold text-ink">This property isn&apos;t available any more</h1>
          <p className="m-0 mt-2 text-[14px] text-gray-600">
            It may have been sold or let. Reply in your chat with the agency and they&apos;ll suggest similar properties.
          </p>
        </div>
      </main>
    );
  }

  const photos = listingPhotos(l);
  const today = new Date().toISOString().slice(0, 10);
  const availableLater = l.available_from && l.available_from > today;
  const photoFolder = isPhotoFolderLink(l.url) ? l.url : null;
  const ownPage = l.url && !photoFolder ? l.url : null;
  const facts: { icon: typeof Ruler; label: string; value: string }[] = [
    l.area_m2 ? { icon: Ruler, label: "Area", value: `${Number(l.area_m2)} m²` } : null,
    l.rooms ? { icon: Building2, label: "Rooms", value: String(l.rooms) } : null,
    l.bedrooms ? { icon: BedDouble, label: "Bedrooms", value: String(l.bedrooms) } : null,
    l.floor != null ? { icon: Building2, label: "Floor", value: l.floor === 0 ? "Ground" : String(l.floor) } : null,
    {
      icon: CalendarDays,
      label: "Available",
      value: availableLater
        ? new Date(`${l.available_from}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
        : "Now",
    },
  ].filter(Boolean) as { icon: typeof Ruler; label: string; value: string }[];

  return (
    <main className="min-h-screen">
      <header className="border-b border-gray-200 bg-glass">
        <div className="mx-auto flex max-w-[960px] items-center justify-between gap-3 px-4 py-3.5 md:px-6">
          <span className="truncate text-[15px] font-semibold text-ink">{l.agency}</span>
          {l.reference && <span className="tabular flex-shrink-0 text-[12.5px] text-gray-500">Ref {l.reference}</span>}
        </div>
      </header>

      <div className="mx-auto grid max-w-[960px] gap-5 px-4 py-5 md:px-6 md:py-8">
        <section className="card overflow-hidden p-3 md:p-4">
          {photos.length > 0 ? (
            <PhotoGallery photos={photos} title={l.title} />
          ) : (
            <div className="flex aspect-[16/9] flex-col items-center justify-center gap-2 rounded-md bg-gray-50 text-center text-gray-500">
              <Images size={28} strokeWidth={1.5} aria-hidden="true" />
              <p className="m-0 max-w-xs text-[13.5px]">Photos are on their way. Ask the agency in your chat and they&apos;ll send them.</p>
            </div>
          )}
        </section>

        <section className="grid gap-5 md:grid-cols-[minmax(0,1fr)_300px] md:items-start">
          <div className="card min-w-0 px-5 py-5 md:px-6">
            <div className="text-[12.5px] font-medium uppercase tracking-wide text-accent">
              {l.transaction_type === "rent" ? "For rent" : "For sale"}
              {l.status === "under_offer" ? " · Under offer" : ""}
            </div>
            <h1 className="m-0 mt-1 text-[22px] font-semibold leading-tight text-ink [text-wrap:balance] md:text-[26px]">{l.title}</h1>
            {(l.address || place(l)) && (
              <p className="m-0 mt-2 flex items-start gap-1.5 text-[14px] text-gray-600">
                <MapPin size={15} strokeWidth={1.75} className="mt-0.5 flex-shrink-0 text-gray-400" aria-hidden="true" />
                <span>{[l.address, place(l)].filter(Boolean).join(", ")}</span>
              </p>
            )}

            <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {facts.map((f) => (
                <Fact key={f.label} {...f} />
              ))}
            </div>

            {l.description && (
              <div className="mt-6">
                <h2 className="m-0 text-[15px] font-semibold text-ink">About this property</h2>
                <p className="m-0 mt-2 max-w-[65ch] whitespace-pre-wrap text-[14.5px] leading-relaxed text-gray-700">{l.description}</p>
              </div>
            )}

            {l.features && l.features.length > 0 && (
              <div className="mt-6">
                <h2 className="m-0 text-[15px] font-semibold text-ink">Features</h2>
                <ul className="m-0 mt-2.5 flex list-none flex-wrap gap-2 p-0">
                  {l.features.map((f) => (
                    <li key={f} className="rounded-full bg-accent-soft px-3 py-1 text-[13px] text-ink">
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <aside className="card px-5 py-5 md:sticky md:top-6">
            <div className="text-[12.5px] text-gray-500">{l.transaction_type === "rent" ? "Monthly rent" : "Price"}</div>
            <div className="tabular mt-0.5 text-[24px] font-semibold text-ink">{formatPrice(l.price, l.currency, l.transaction_type)}</div>
            <p className="m-0 mt-4 text-[13.5px] leading-relaxed text-gray-600">
              Want to see it in person? Reply in your chat with {l.agency} and you&apos;ll be offered a time for a viewing.
            </p>
            {(ownPage || photoFolder) && (
              <a
                href={(ownPage || photoFolder)!}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-accent underline-offset-2 hover:underline"
              >
                {ownPage ? "See it on the agency's website" : "See all photos"}
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            )}
          </aside>
        </section>
      </div>
    </main>
  );
}
