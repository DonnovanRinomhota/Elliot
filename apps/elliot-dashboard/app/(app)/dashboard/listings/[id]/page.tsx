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
      <BackButton fallback="/dashboard/listings" />
      <PageHeader
        title={listing.title}
        description={
          listing.times_suggested
            ? `Elliot has suggested this listing ${listing.times_suggested} time${listing.times_suggested === 1 ? "" : "s"}, most recently ${timeAgo(listing.last_suggested_at)}.`
            : "Elliot hasn't suggested this listing to anyone yet."
        }
      />
      <ListingForm tenantId={tenantId} listing={listing} />
    </div>
  );
}
