// GET /api/attachments/:id -- opens a file a client attached to an email
// (0046). The row is read with the user's own session, so row-level security
// decides whether this agency may see it; only then is a one-minute link to
// the private email-attachments bucket made with the service role.
// ?download=1 saves the file instead of opening it in the browser.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: file } = await supabase
    .from("message_attachments")
    .select("filename, storage_path, uploaded")
    .eq("id", params.id)
    .maybeSingle();
  if (!file) return NextResponse.json({ error: "File not found." }, { status: 404 });
  if (!file.uploaded) return NextResponse.json({ error: "This file couldn't be saved when the email arrived." }, { status: 410 });

  const download = new URL(request.url).searchParams.get("download") === "1";
  const { data, error } = await createAdminClient()
    .storage.from("email-attachments")
    .createSignedUrl(file.storage_path, 60, download ? { download: file.filename } : undefined);
  if (error || !data?.signedUrl) return NextResponse.json({ error: error?.message || "Couldn't open the file." }, { status: 500 });
  return NextResponse.redirect(data.signedUrl, { status: 302 });
}
