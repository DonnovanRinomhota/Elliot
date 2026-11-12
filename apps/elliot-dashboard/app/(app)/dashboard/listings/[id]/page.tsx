import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/tenant";
import { PageHeader, timeAgo } from "../../../../_ui/ui";
import ListingForm from "../listing-form";
import BackButton from "@/app/_ui/back-button";

export default async function EditListingPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [tenantId, { data: listing }] = await Promise.all([
    getCurrentTenantId(supabase),
    supabase.from("listings").select("*").eq("id", params.id).maybeSingle(),
  ]);
  if (!listing || !tenantId) notFound();
  return (
    <div>
      <PageHeader back={<BackButton fallback="/dashboard/listings" onDark />}
        title={listing.title}
        description={
          listing.times_suggested
            ? `Elliot has suggested this listing ${listing.times_suggested} time${listing.times_suggested === 1 ? "" : "s"}, most recently ${timeAgo(listing.last_suggested_at)}.`
            : "Elliot hasn't suggested this listing to anyone yet."
        }
      />
      {listing.source === "asari" && (
        <p className="mb-4 max-w-2xl rounded-lg bg-accent-soft px-3 py-2 text-[12.5px] text-accent-dark">
          From ASARI CRM. Make changes in ASARI: Elliot copies them within the hour, and changes made here are replaced on the next update.
        </p>
      )}
      <ListingForm tenantId={tenantId} listing={listing} />
    </div>
  );
}
