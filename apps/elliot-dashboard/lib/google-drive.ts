// Photos from shared Google Drive folders.
//
// Agencies often keep each property's photos in a Drive folder and put the
// folder link in their spreadsheet. Elliot reads the folder's image files
// with the Google Drive API (an API key is enough when the folder is shared
// as "Anyone with the link") and stores a link to each photo, so the photos
// stay in Drive and nothing is copied or uploaded.
//
// Env (Vercel, server-only): GOOGLE_DRIVE_API_KEY
// (GOOGLE_DRIVE_API_BASE overrides the API address; only for tests.)
// Pure helpers are unit tested in lib/google-drive.test.ts.

import { MAX_PHOTOS } from "./listing-photos";

const DRIVE_THUMB = "https://drive.google.com/thumbnail";

/** The folder id in a Drive folder link, or null. */
export function driveFolderId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m =
    /drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,})/.exec(url) ??
    /drive\.google\.com\/(?:open|embeddedfolderview)\?(?:[^#]*&)?id=([A-Za-z0-9_-]{10,})/.exec(url);
  return m ? m[1] : null;
}

/** Link that shows a Drive image at the given width (works for files shared with anyone with the link). */
export function driveImageUrl(fileId: string, width = 1600): string {
  return `${DRIVE_THUMB}?id=${encodeURIComponent(fileId)}&sz=w${width}`;
}

export function isDriveImageUrl(url: string): boolean {
  return url.startsWith(`${DRIVE_THUMB}?id=`);
}

/** Same Drive image, smaller: for list thumbnails. Other links are returned as they are. */
export function resizedPhotoUrl(url: string, width: number): string {
  return isDriveImageUrl(url) ? url.replace(/([?&])sz=w\d+/, `$1sz=w${width}`) : url;
}

/**
 * New photo list after reading a folder: the agency's own uploads and other
 * links first (in their order, so a chosen cover stays the cover), then the
 * folder's photos. Drive photos from an earlier read are replaced.
 */
export function mergeDrivePhotos(existing: string[], driveUrls: string[], max = MAX_PHOTOS): string[] {
  const own = existing.filter((p) => !isDriveImageUrl(p));
  const merged = [...own, ...driveUrls.filter((u) => !own.includes(u))];
  return merged.slice(0, max);
}

export class DriveError extends Error {
  constructor(message: string, public readonly kind: "not_configured" | "not_shared" | "api" | "busy") {
    super(message);
  }
}

type DriveFile = { id: string; name: string; mimeType: string };

async function listChildren(folderId: string, key: string, query: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false and (${query})`,
      fields: "nextPageToken, files(id, name, mimeType)",
      orderBy: "name_natural",
      pageSize: "100",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      key,
    });
    if (pageToken) params.set("pageToken", pageToken);
    const base = (process.env.GOOGLE_DRIVE_API_BASE || "https://www.googleapis.com").replace(/\/$/, "");
    const res = await fetch(`${base}/drive/v3/files?${params}`, { cache: "no-store" });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const reason = data?.error?.errors?.[0]?.reason || data?.error?.status || "";
      const msg = data?.error?.message || `Google Drive returned ${res.status}`;
      if (res.status === 404 || reason === "notFound") throw new DriveError("Folder not found, or not shared as “Anyone with the link”.", "not_shared");
      if (res.status === 429 || /rateLimit|userRateLimit/i.test(reason)) throw new DriveError("Google Drive is busy. Try again in a minute.", "busy");
      if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason + msg)) {
        throw new DriveError("The Google Drive API isn't switched on for this API key's Google Cloud project.", "not_configured");
      }
      if (res.status === 400 && /API key not valid/i.test(msg)) throw new DriveError("GOOGLE_DRIVE_API_KEY isn't a valid API key.", "not_configured");
      throw new DriveError(msg, "api");
    }
    files.push(...((data?.files ?? []) as DriveFile[]));
    pageToken = data?.nextPageToken;
  } while (pageToken && files.length < 300);
  return files;
}

/**
 * Image links in a shared folder, in name order. Also looks one level into
 * subfolders (e.g. "kitchen", "bedroom"), up to `max` photos.
 */
export async function drivePhotosForFolder(folderUrl: string, max = MAX_PHOTOS): Promise<string[]> {
  const key = process.env.GOOGLE_DRIVE_API_KEY;
  if (!key) {
    throw new DriveError("Reading Google Drive folders isn't switched on yet: add GOOGLE_DRIVE_API_KEY in Vercel and redeploy.", "not_configured");
  }
  const folderId = driveFolderId(folderUrl);
  if (!folderId) throw new DriveError("That isn't a Google Drive folder link.", "api");

  const images = await listChildren(folderId, key, "mimeType contains 'image/'");
  const out = images.map((f) => driveImageUrl(f.id));
  if (out.length < max) {
    const subfolders = await listChildren(folderId, key, "mimeType = 'application/vnd.google-apps.folder'");
    for (const sub of subfolders.slice(0, 6)) {
      if (out.length >= max) break;
      const more = await listChildren(sub.id, key, "mimeType contains 'image/'");
      out.push(...more.map((f) => driveImageUrl(f.id)));
    }
  }
  return out.slice(0, max);
}
