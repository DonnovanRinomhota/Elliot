"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MAX_PHOTOS, PHOTO_BUCKET, move, photoUrl, shrinkImage } from "@/lib/listing-photos";
import { driveFolderId, mergeDrivePhotos, resizedPhotoUrl } from "@/lib/google-drive";
import { ErrorText, btn } from "../../../_ui/ui";

// Upload, order and remove a listing's photos. Photos upload straight away
// (shrunk in the browser first); the order and removals are saved with the
// listing. The first photo is the cover.
export default function PhotoManager({
  tenantId,
  listingId,
  photos,
  onChange,
  folderUrl,
}: {
  tenantId: string;
  listingId: string;
  photos: string[];
  onChange: (photos: string[]) => void;
  /** The listing's link; when it's a Google Drive folder, photos can be read from it. */
  folderUrl?: string;
}) {
  const supabase = createClient();
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [driveBusy, setDriveBusy] = useState(false);
  const hasFolder = Boolean(driveFolderId(folderUrl));

  async function fromDrive() {
    setDriveBusy(true);
    setError(null);
    const res = await fetch("/api/listings/drive-photos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder_url: folderUrl }),
    });
    const data = await res.json().catch(() => null);
    setDriveBusy(false);
    if (!res.ok || !data?.success) return setError(data?.error || "Couldn't read the Drive folder.");
    if (!data.photos.length) return setError("That folder has no photos in it.");
    onChange(mergeDrivePhotos(photos, data.photos));
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setError(null);
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) return setError(`A listing can have up to ${MAX_PHOTOS} photos.`);
    const chosen = files.slice(0, room);
    const added: string[] = [];
    const problems: string[] = [];
    for (let i = 0; i < chosen.length; i++) {
      const file = chosen[i];
      setUploading(`Uploading ${i + 1} of ${chosen.length}…`);
      if (!file.type.startsWith("image/")) {
        problems.push(`${file.name} isn't a photo`);
        continue;
      }
      if (file.size > 25 * 1024 * 1024) {
        problems.push(`${file.name} is over 25 MB`);
        continue;
      }
      try {
        const blob = await shrinkImage(file);
        const path = `${tenantId}/${listingId}/${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await supabase.storage
          .from(PHOTO_BUCKET)
          .upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
        if (upErr) throw upErr;
        added.push(path);
      } catch (err) {
        problems.push(`${file.name}: ${(err as Error).message}`);
      }
    }
    setUploading(null);
    if (added.length) onChange([...photos, ...added]);
    if (files.length > room) problems.push(`Only ${room} more photo${room === 1 ? "" : "s"} fit (max ${MAX_PHOTOS}).`);
    if (problems.length) setError(problems.join(". "));
  }

  function addLink() {
    const url = link.trim();
    if (!/^https:\/\/\S+$/i.test(url)) return setError("Paste a full link starting with https://");
    if (photos.length >= MAX_PHOTOS) return setError(`A listing can have up to ${MAX_PHOTOS} photos.`);
    setError(null);
    onChange([...photos, url]);
    setLink("");
  }

  return (
    <div className="grid gap-3">
      {photos.length > 0 ? (
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((p, i) => (
            <li key={p} className="overflow-hidden rounded-md border border-gray-200 bg-glass">
              <div className="relative aspect-[4/3] bg-gray-100">
                <a href={photoUrl(p)} target="_blank" rel="noreferrer" className="block h-full w-full" title="Open full size">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={resizedPhotoUrl(photoUrl(p), 480)} alt={`Photo ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />
                </a>
                {i === 0 ? (
                  <span className="absolute left-1.5 top-1.5 rounded bg-navy px-1.5 py-0.5 text-[11px] font-medium text-white">Cover</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onChange(move(photos, i, 0))}
                    className="absolute left-1.5 top-1.5 rounded bg-glass px-1.5 py-0.5 text-[11px] font-medium text-ink shadow-sm hover:bg-glass-hi"
                  >
                    Make cover
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between gap-1 px-1 py-1">
                <div className="flex">
                  <button type="button" onClick={() => onChange(move(photos, i, i - 1))} disabled={i === 0} className={`${btn.ghost} !h-7 !px-2`} aria-label="Move earlier">
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(move(photos, i, i + 1))}
                    disabled={i === photos.length - 1}
                    className={`${btn.ghost} !h-7 !px-2`}
                    aria-label="Move later"
                  >
                    →
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => onChange(photos.filter((_, j) => j !== i))}
                  className={`${btn.dangerGhost} !h-7 !px-2 !text-[12px]`}
                  aria-label={`Remove photo ${i + 1}`}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[13px] text-gray-500">No photos yet. The first photo you add becomes the cover in your listings.</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className={`${btn.secondary} cursor-pointer ${uploading ? "pointer-events-none opacity-50" : ""}`}>
          Add photos
          <input type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple onChange={upload} className="sr-only" />
        </label>
        {hasFolder && (
          <button type="button" onClick={fromDrive} disabled={driveBusy} className={btn.secondary}>
            {driveBusy ? "Reading the folder…" : "Get photos from the Drive folder"}
          </button>
        )}
        {uploading && (
          <span className="text-[13px] text-gray-600" role="status">
            {uploading}
          </span>
        )}
        <span className="text-[12.5px] text-gray-500">
          {photos.length} of {MAX_PHOTOS}. Photos are resized automatically.
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <label htmlFor="photo-link" className="sr-only">
          Photo link
        </label>
        <input
          id="photo-link"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="Or paste a link to a photo (https://…)"
          className="h-9 min-w-[240px] flex-1 px-3"
        />
        <button type="button" onClick={addLink} disabled={!link.trim()} className={btn.secondary}>
          Add link
        </button>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}
