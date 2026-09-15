import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import KnowledgeForm from "./knowledge-form";

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
    return <p className="text-sm text-red-700">No tenant found for this account.</p>;
  }

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("slug")
    .eq("id", tenantUser.tenant_id)
    .single();

  if (tenantError || !tenant) {
    return <p className="text-sm text-red-700">Failed to load tenant: {tenantError?.message}</p>;
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-medium">Knowledge base</h1>
      <p className="mb-1 text-sm text-gray-500">Content Elliot draws on when answering FAQ / RAG questions.</p>
      <p className="mb-6 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Plain text only for now -- paste content in directly. There&apos;s no PDF or website parsing yet
        (08-knowledge-ingestion.json&apos;s own validation comment confirms this is Phase 3 scope). The source
        type below is for your own categorization only; it doesn&apos;t change how the text is processed.
      </p>
      <KnowledgeForm tenantSlug={tenant.slug} />
    </div>
  );
}
