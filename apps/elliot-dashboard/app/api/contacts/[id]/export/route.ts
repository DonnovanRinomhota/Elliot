// GET /api/contacts/:id/export -- a copy of everything Elliot holds about one
// client, as a JSON file (GDPR access / portability request). Agency admins
// only: the database checks the role and the agency, and records the export
// in the activity log (0051, export_client).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exportFileName, privacyError } from "@/lib/privacy";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: "Not signed in." }, { status: 401 });

  const { data, error } = await supabase.rpc("export_client", { p_contact_id: params.id });
  if (error) {
    const e = privacyError(error.message, error.code);
    return NextResponse.json({ success: false, error: e.error }, { status: e.status });
  }

  const name = (data as { contact?: { name?: string | null } } | null)?.contact?.name;
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
