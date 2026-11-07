import { PageHeader } from "../../../../_ui/ui";
import ImportForm from "./import-form";
import BackButton from "@/app/_ui/back-button";

export default function ImportListingsPage() {
  return (
    <div>
      <BackButton fallback="/dashboard/listings" />
      <PageHeader
        title="Import listings"
        description="Upload the listings you already have, in whatever format they're in. Listings you've imported before are updated, not duplicated. Nothing is saved until you confirm."
      />
      <ImportForm />
    </div>
  );
}
