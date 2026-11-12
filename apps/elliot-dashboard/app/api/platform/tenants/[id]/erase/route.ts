// POST /api/platform/tenants/:id/erase -- control panel: delete everything of
// an agency that has left. Platform admins only. The database refuses unless
// the agency is Cancelled and the typed short name matches (0051,
// erase_agency); it deletes every row and returns the stored files and the
// logins that belonged only to this agency, which are removed here.
//
// Body: { "slug": "<the agency's short name>" }
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformAdmin } from "@/lib/platform-auth";
import { isAdminEmail } from "@/lib/admin";
import { chunk, filesByBucket } from "@/lib/privacy";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getPlatformAdmin();
  if (!user) return NextResponse.json({ success: false, error: "Platform admins only." }, { status: 403 });

  let body: { slug?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    /* checked by the database */
  }
  const slug = String(body.slug ?? "").trim();

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("erase_agency", { p_tenant_id: params.id, p_confirm_slug: slug, p_actor: user.email ?? "platform" });
  if (error) {
    const missing = /erase_agency/.test(error.message) && /function|schema cache/i.test(error.message);
    return NextResponse.json(
      { success: false, error: missing ? "Run migration 0051 in Supabase first." : error.message },
      { status: /not found/i.test(error.message) ? 404 : 400 }
    );
  }
  const result = (data ?? {}) as { name?: string; counts?: Record<string, number>; files?: unknown; logins?: unknown };

  let filesNotRemoved = 0;
  for (const [bucket, paths] of Object.entries(filesByBucket(result.files))) {
    for (const batch of chunk(paths)) {
      const { error: rmError } = await admin.storage.from(bucket).remove(batch);
      if (rmError) {
        filesNotRemoved += batch.length;
        console.error("[erase-agency] could not remove files", { bucket, count: batch.length, error: rmError.message });
      }
    }
  }

  // Logins that belonged only to this agency. Never a platform admin's.
  let loginsNotRemoved = 0;
  const ids = Array.isArray(result.logins) ? result.logins.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
  for (const id of ids) {
    const { data: u } = await admin.auth.admin.getUserById(id);
    if (u?.user && (u.user.id === user.id || isAdminEmail(u.user.email))) continue;
    const { error: delError } = await admin.auth.admin.deleteUser(id);
    if (delError && !/not found/i.test(delError.message)) {
      loginsNotRemoved += 1;
      console.error("[erase-agency] could not remove login", { error: delError.message });
    }
  }

  return NextResponse.json({
    success: true,
    name: result.name ?? null,
    counts: result.counts ?? {},
    files_not_removed: filesNotRemoved,
    logins_not_removed: loginsNotRemoved,
  });
}
