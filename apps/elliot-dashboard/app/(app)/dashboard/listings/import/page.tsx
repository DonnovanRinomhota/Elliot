import { PageHeader } from "../../../../_ui/ui";
import ImportForm from "./import-form";

export default function ImportListingsPage() {
  return (
    <div>
      <a href="/dashboard/listings" className="text-[13px] text-gray-500 no-underline hover:text-ink">Listings</a>
      <PageHeader
        title="Import listings"
        description="Upload a spreadsheet saved as CSV. Rows with a reference you already have update that listing; the rest are added. Nothing is saved until you confirm."
      />
      <ImportForm />
    </div>
  );
}
