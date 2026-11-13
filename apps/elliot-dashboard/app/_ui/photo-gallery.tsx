"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { resizedPhotoUrl } from "@/lib/google-drive";

// Big photo with previous/next, and a strip of thumbnails underneath.
export default function PhotoGallery({ photos, title }: { photos: string[]; title: string }) {
  const [i, setI] = useState(0);
  const n = photos.length;
  const go = (d: number) => setI((x) => (x + d + n) % n);

  return (
    <div className="grid gap-2">
      <div className="relative aspect-[16/10] overflow-hidden rounded-md bg-gray-100">
        <a href={photos[i]} target="_blank" rel="noreferrer" title="Open full size">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={resizedPhotoUrl(photos[i], 1600)} alt={`${title}, photo ${i + 1} of ${n}`} className="h-full w-full object-cover" />
        </a>
        {n > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous photo"
              className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-glass text-ink shadow-sm hover:bg-glass-hi"
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next photo"
              className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-glass text-ink shadow-sm hover:bg-glass-hi"
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
            <span className="tabular absolute bottom-2 right-2 rounded bg-navy/80 px-2 py-0.5 text-[12px] font-medium text-white">
              {i + 1} / {n}
            </span>
          </>
        )}
      </div>
      {n > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((p, j) => (
            <button
              key={p}
              type="button"
              onClick={() => setI(j)}
              aria-label={`Show photo ${j + 1}`}
              aria-current={i === j ? "true" : undefined}
              className={`h-14 w-20 flex-shrink-0 overflow-hidden rounded border-2 ${i === j ? "border-accent" : "border-transparent opacity-75 hover:opacity-100"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={resizedPhotoUrl(p, 240)} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
