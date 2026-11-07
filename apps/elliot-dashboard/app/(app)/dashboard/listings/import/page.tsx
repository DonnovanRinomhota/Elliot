import { PageHeader } from "../../../../_ui/ui";
import ImportForm from "./import-form";

export default function ImportListingsPage() {
  return (
    <div>
      <a href="/dashboard/listings" className="text-[13px] text-gray-500 no-underline hover:text-ink">Listings</a>
      <PageHeader
        title="Import listings"
        description="Upload the listings you already have, in whatever format they're in. Listings you've imported before are updated, not duplicated. Nothing is saved until you confirm."
      />
      <ImportForm />
    </div>
  );
}
