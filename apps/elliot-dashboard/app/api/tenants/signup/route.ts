// POST /api/tenants/signup
//
// Called from the "Create Business" form AFTER the browser has already
// called supabase.auth.signUp() (that's what creates the auth.users row and
// triggers Supabase's built-in confirmation email -- this route never
// touches passwords or sends auth emails itself).
//
// This route's only job: given a freshly-created but not-yet-linked auth
// user, create their tenant + ai_config + first tenant_users row (role:
// 'admin') so they land in the dashboard scoped to their own business.
// Runs with the service-role client because tenants/tenant_users RLS has no
// path for "insert a tenant for myself" -- see lib/supabase/admin.ts.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function POST(request: Request) {
  let body: { tenantName?: string; authUserId?: string; email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body." }, { status: 400 });
  }

  const { tenantName, authUserId, email } = body;
  if (!tenantName?.trim() || !authUserId || !email) {
    return NextResponse.json(
      { success: false, error: "tenantName, authUserId, and email are all required." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Verify the auth user actually exists and the id wasn't spoofed by the
  // client -- the service-role client can look this up directly.
  const { data: authUser, error: authLookupError } = await supabase.auth.admin.getUserById(authUserId);
  if (authLookupError || !authUser?.user || authUser.user.email?.toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ success: false, error: "Could not verify the new account." }, { status: 400 });
  }

  // Guard against someone re-submitting for a user that already has a tenant.
  const { data: existingMembership } = await supabase
    .from("tenant_users")
    .select("tenant_id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (existingMembership) {
    return NextResponse.json({ success: true, tenant_id: existingMembership.tenant_id });
  }

  const baseSlug = slugify(tenantName) || "business";

  // Slug is unique; retry a couple of times with a short random suffix on
  // collision rather than bouncing the user back to the form.
  let tenantId: string | null = null;
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 5 && !tenantId; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .insert({ name: tenantName.trim(), slug })
      .select("id")
      .single();

    if (!tenantError && tenant) {
      tenantId = tenant.id;
      break;
    }
    lastError = tenantError?.message ?? "Unknown error creating tenant.";
    // 23505 = unique_violation -- only worth retrying on a slug clash.
    if (tenantError?.code !== "23505") break;
  }

  if (!tenantId) {
    return NextResponse.json({ success: false, error: lastError ?? "Could not create tenant." }, { status: 500 });
  }

  const { error: aiConfigError } = await supabase.from("ai_config").insert({ tenant_id: tenantId });
  const { error: tenantUserError } = await supabase.from("tenant_users").insert({
    tenant_id: tenantId,
    auth_user_id: authUserId,
    email: authUser.user.email,
    role: "admin",
  });

  if (aiConfigError || tenantUserError) {
    // Best-effort rollback -- the tenant row would otherwise be orphaned
    // with no user attached to it.
    await supabase.from("tenants").delete().eq("id", tenantId);
    return NextResponse.json(
      { success: false, error: aiConfigError?.message ?? tenantUserError?.message ?? "Setup failed." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, tenant_id: tenantId });
}
