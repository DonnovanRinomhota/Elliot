// Listing photos: where they live and how they're shown.
// Entries in listings.photos are storage paths in the public
// "listing-photos" bucket (<tenant_id>/<listing_id>/<file>.jpg) or full
// https links to photos hosted elsewhere. See db/migrations/0029.

export const PHOTO_BUCKET = "listing-photos";
export const MAX_PHOTOS = 20;

const isLink = (s: string) => /^https?:\/\//i.test(s);

/** Public URL for a photo entry. Works on the server and in the browser. */
export function photoUrl(entry: string, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""): string {
  if (isLink(entry)) return entry;
  const path = entry.split("/").map(encodeURIComponent).join("/");
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${PHOTO_BUCKET}/${path}`;
}

/** All photo URLs for a listing, cover first. Falls back to the older single image_url. */
export function listingPhotos(listing: { photos?: string[] | null; image_url?: string | null }): string[] {
  const photos = (listing.photos ?? []).filter(Boolean);
  if (photos.length) return photos.map((p) => photoUrl(p));
  return listing.image_url ? [listing.image_url] : [];
}

/** Storage paths (not outside links) that were in `before` but aren't in `after`: safe to delete. */
export function removedStoragePaths(before: string[], after: string[]): string[] {
  const keep = new Set(after);
  return before.filter((p) => !isLink(p) && !keep.has(p));
}

/** Moves item `from` to position `to`, returning a new array. */
export function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Links that are folders of photos (Google Drive, Dropbox), not single images. */
export function isPhotoFolderLink(url: string | null | undefined): boolean {
  return Boolean(url && /drive\.google\.com\/drive\/folders|dropbox\.com\/(sh|scl)\//i.test(url));
}

/**
 * Browser only: shrinks a photo to at most `max` px on its longer side and
 * re-encodes it as JPEG, so a 6 MB phone photo uploads as ~300 KB.
 */
export async function shrinkImage(file: File, max = 1600, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't process photos.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't process this photo."))), "image/jpeg", quality)
  );
}
