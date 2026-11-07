"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

// "Back" to the page you came from (keeping its filters and page number).
// Opened from a link elsewhere (an email, a bookmark), it goes to `fallback`.
export default function BackButton({ fallback, label = "Back" }: { fallback: string; label?: string }) {
  const router = useRouter();
  return (
    <a
      href={fallback}
      onClick={(e) => {
        const cameFromHere = typeof document !== "undefined" && document.referrer.startsWith(window.location.origin);
        if (cameFromHere && window.history.length > 1) {
          e.preventDefault();
          router.back();
        }
      }}
      className="mb-2 inline-flex h-8 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 text-[13px] font-medium text-ink no-underline shadow-sm hover:bg-gray-50"
    >
      <ArrowLeft size={15} aria-hidden="true" />
      {label}
    </a>
  );
}
