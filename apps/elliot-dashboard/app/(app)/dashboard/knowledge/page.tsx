import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import KnowledgeForm from "./knowledge-form";
import { PageHeader } from "../../../_ui/ui";

export default async function KnowledgePage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: tenantUser } = await supabase
    .from("tenant_users")
    .select("tenant_id")
    .eq("auth_user_id", user.id)
    .single();

  if (!tenantUser) {
    return <p className="text-sm text-alert">No tenant found for this account.</p>;
  }

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("slug")
    .eq("id", tenantUser.tenant_id)
    .single();

  if (tenantError || !tenant) {
    return <p className="text-sm text-alert">Failed to load tenant: {tenantError?.message}</p>;
  }

  return (
    <div>
      <PageHeader
        title="Knowledge base"
        description="What Elliot knows about your business: listings, prices, areas, opening hours and FAQs. Elliot answers clients from this content."
      />
      <p className="mb-6 max-w-3xl text-[13px] text-gray-500">
        Scanned PDFs (photos of pages) and websites that load their content with JavaScript can&apos;t be read yet. If
        an upload comes back empty, paste the text instead.
      </p>
      <KnowledgeForm tenantSlug={tenant.slug} />
    </div>
  );
}
