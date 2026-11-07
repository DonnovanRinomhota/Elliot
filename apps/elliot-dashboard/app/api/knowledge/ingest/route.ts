// POST /api/knowledge/ingest
//   body: { title, source_type, text? , url? }
//
// Adds a document to the signed-in user's knowledge base via n8n workflow 08.
//
// The browser used to call workflow 08 directly with a tenant_slug it chose
// itself, so anyone with the URL could add documents to ANY tenant's
// knowledge base -- and the AI answers customers from that content. Now the
// tenant comes from the user's own session (RLS), never from the request,
// and n8n is called server-side with the shared webhook secret.
//
// PDFs are still turned into text in the browser (knowledge-form.tsx); only
// the extracted text comes through here. Vercel caps request bodies at about
// 4.5 MB, which is far more text than a typical PDF holds.
//
// Env (server-only): N8N_INGEST_WEBHOOK_URL. Falls back to the old
// NEXT_PUBLIC_N8N_INGEST_WEBHOOK_URL until it's renamed.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/tenant";
import { callInternalWebhook } from "@/lib/n8n-webhook";

// Ingestion embeds every chunk (Voyage) before n8n responds, so give it the
// longest time Vercel's Hobby plan allows.
export const maxDuration = 60;

// Same list as knowledge-form.tsx / workflow 08's Validate Input.
const SOURCE_TYPES = ["faq", "manual_text", "pdf", "website", "other"];

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not signed in." }, { status: 401 });
  }

  let body: { title?: string; source_type?: string; text?: string; url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const title = String(body.title || "").trim();
  const sourceType = String(body.source_type || "");
  if (!title) {
    return NextResponse.json({ success: false, error: "Title is required." }, { status: 400 });
  }
  if (!SOURCE_TYPES.includes(sourceType)) {
    return NextResponse.json({ success: false, error: "Unknown source type." }, { status: 400 });
  }
  const isWebsite = sourceType === "website";
  if (isWebsite ? !String(body.url || "").trim() : !String(body.text || "").trim()) {
    return NextResponse.json(
      { success: false, error: isWebsite ? "A website URL is required." : "Some text is required." },
      { status: 400 }
    );
  }

  // RLS on tenant_users / tenants scopes both reads to the user's own tenant.
  // current_tenant_id(): the user's agency, or the one a platform admin is viewing.
  const currentTenantId = await getCurrentTenantId(supabase);
  const tenantUser = currentTenantId ? { tenant_id: currentTenantId } : null;
  const { data: tenant } = tenantUser
    ? await supabase.from("tenants").select("slug").eq("id", tenantUser.tenant_id).maybeSingle()
    : { data: null };
  if (!tenant?.slug) {
    return NextResponse.json({ success: false, error: "No tenant found for this account." }, { status: 403 });
  }

  const urlEnv = process.env.N8N_INGEST_WEBHOOK_URL ? "N8N_INGEST_WEBHOOK_URL" : "NEXT_PUBLIC_N8N_INGEST_WEBHOOK_URL";
  const result = await callInternalWebhook(urlEnv, {
    tenant_slug: tenant.slug,
    title,
    source_type: sourceType,
    ...(isWebsite ? { url: String(body.url).trim() } : { text: String(body.text) }),
  });
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.data);
}
