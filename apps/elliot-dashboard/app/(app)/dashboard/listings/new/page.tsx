import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/tenant";
import { PageHeader } from "../../../../_ui/ui";
import ListingForm from "../listing-form";
import BackButton from "@/app/_ui/back-button";

export default async function NewListingPage() {
  const tenantId = await getCurrentTenantId(createClient());
  if (!tenantId) return <p className="text-[13px] text-alert">No agency found for this account.</p>;
  return (
    <div>
      <PageHeader back={<BackButton fallback="/dashboard/listings" onDark />} title="Add listing" description="Elliot can offer it to clients as soon as it's saved as Available." />
      <ListingForm tenantId={tenantId} />
    </div>
  );
}
