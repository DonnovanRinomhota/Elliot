// POST /api/listings/drive-photos
//
// Two uses:
//   { folder_url }                 -> { photos }  one folder, nothing saved
//                                     (the listing form's "Get photos" button)
//   { mode: "missing" | "refresh", cursor? }
//                                  -> works through the agency's listings whose
//                                     link is a Google Drive folder, BATCH at a
//                                     time, saving the photo links. "missing" =
//                                     only listings without photos; "refresh" =
//                                     re-read every folder (keeps uploaded photos).
//                                     The browser calls again with next_cursor
//                                     until done, so 10,000 listings is just
//                                     more calls, each well inside the time limit.
// Runs as the signed-in user, so RLS keeps it inside their agency.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/tenant";
import { DriveError, drivePhotosForFolder, mergeDrivePhotos } from "@/lib/google-drive";

export const maxDuration = 60;

const BATCH = 20;
const PARALLEL = 5;

const DRIVE_FILTER = "%drive.google.com%";

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: "Not signed in." }, { status: 401 });
  if (!(await getCurrentTenantId(supabase))) {
    return NextResponse.json({ success: false, error: "No agency found for this account." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));

  // ── One folder, for the form ──
  if (body?.folder_url) {
    try {
      const photos = await drivePhotosForFolder(String(body.folder_url));
      return NextResponse.json({ success: true, photos });
    } catch (e) {
      const err = e as DriveError;
      return NextResponse.json({ success: false, error: err.message, kind: err.kind }, { status: err.kind === "not_configured" ? 503 : 400 });
    }
  }

  // ── A batch of listings ──
  const mode = body?.mode === "refresh" ? "refresh" : "missing";
  const cursor = typeof body?.cursor === "string" ? body.cursor : null;

  const base = () => {
    let q = supabase.from("listings").select("id", { count: "exact", head: true }).ilike("url", DRIVE_FILTER);
    if (mode === "missing") q = q.eq("photos", "{}");
    return q;
  };
  let batchQuery = supabase.from("listings").select("id, title, url, photos").ilike("url", DRIVE_FILTER);
  if (mode === "missing") batchQuery = batchQuery.eq("photos", "{}");
  if (cursor) batchQuery = batchQuery.gt("id", cursor);
  const { data: batch, error } = await batchQuery.order("id").limit(BATCH);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const results: { id: string; title: string; photos?: number; error?: string }[] = [];
  let stop: DriveError | null = null;
  const queue = [...(batch ?? [])];
  const worker = async () => {
    while (queue.length && !stop) {
      const l = queue.shift()!;
      try {
        const drive = await drivePhotosForFolder(l.url as string);
        const photos = mergeDrivePhotos((l.photos as string[]) ?? [], drive);
        const { error: upErr } = await supabase
          .from("listings")
          .update({ photos, image_url: photos[0] && /^https?:/i.test(photos[0]) ? photos[0] : null })
          .eq("id", l.id);
        if (upErr) throw new Error(upErr.message);
        results.push({ id: l.id, title: l.title, photos: drive.length });
      } catch (e) {
        const err = e as DriveError;
        // A missing key or switched-off API affects every listing: stop and say so once.
        if (err instanceof DriveError && (err.kind === "not_configured" || err.kind === "busy")) stop = err;
        else results.push({ id: l.id, title: l.title, error: err.message });
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  if (stop) {
    const err = stop as DriveError;
    return NextResponse.json({ success: false, error: err.message, kind: err.kind }, { status: err.kind === "busy" ? 429 : 503 });
  }

  const lastId = batch && batch.length ? (batch[batch.length - 1].id as string) : null;
  // "missing" listings that got no photos keep matching the filter, so the
  // cursor (not the filter) is what moves us forward in both modes.
  let remainingQ = base();
  if (lastId) remainingQ = remainingQ.gt("id", lastId);
  const { count: remaining } = await remainingQ;

  return NextResponse.json({
    success: true,
    processed: results.length,
    updated: results.filter((r) => r.photos).length,
    empty: results.filter((r) => r.photos === 0).map((r) => ({ id: r.id, title: r.title })),
    failed: results.filter((r) => r.error).map((r) => ({ id: r.id, title: r.title, error: r.error })),
    next_cursor: batch && batch.length === BATCH ? lastId : null,
    remaining: batch && batch.length === BATCH ? remaining ?? 0 : 0,
  });
}
