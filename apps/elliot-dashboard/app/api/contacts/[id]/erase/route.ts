// POST /api/contacts/:id/erase -- delete a client and everything Elliot holds
// about them (GDPR erasure request). Agency admins only. The database checks
// the role and the agency, deletes the rows and records that it happened
// without any personal data (0051, erase_client). The stored email
// attachments it returns are then removed from Storage here.
//
// Body: { "confirm": "delete" } -- the word the admin typed.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { chunk, erasedSummary, parseEraseResult, privacyError } from "@/lib/privacy";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: "Not signed in." }, { status: 401 });

  let body: { confirm?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    /* checked below */
  }
  if (String(body.confirm ?? "").trim().toLowerCase() !== "delete") {
    return NextResponse.json({ success: false, error: 'Type "delete" to confirm.' }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("erase_client", { p_contact_id: params.id });
  if (error) {
    const e = privacyError(error.message, error.code);
    return NextResponse.json({ success: false, error: e.error }, { status: e.status });
  }
  const result = parseEraseResult(data);

  // The rows are gone; now the files they pointed at. The paths came from the
  // database for this agency only, after it checked the caller.
  let filesNotRemoved = 0;
  if (result.storage_paths.length) {
    const storage = createAdminClient().storage.from("email-attachments");
    for (const batch of chunk(result.storage_paths)) {
      const { error: rmError } = await storage.remove(batch);
      if (rmError) {
        filesNotRemoved += batch.length;
        console.error("[erase] could not remove files", { count: batch.length, error: rmError.message });
      }
    }
  }

  return NextResponse.json({
    success: true,
    summary: erasedSummary(result),
    calendar_events: result.calendar_events,
    files_not_removed: filesNotRemoved,
  });
}
