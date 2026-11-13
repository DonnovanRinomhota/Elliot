"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

// "Back" to the page you came from (keeping its filters and page number).
// Opened from a link elsewhere (an email, a bookmark), it goes to `fallback`.
export default function BackButton({ fallback, label = "Back", onDark = false }: { fallback: string; label?: string; onDark?: boolean }) {
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
      className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium no-underline ${
        onDark ? "border-white/25 bg-[#071a3a]/45 text-white hover:bg-[#071a3a]/65" : "mb-2 border-gray-200 bg-glass text-ink shadow-sm hover:bg-glass-hi"
      }`}
    >
      <ArrowLeft size={15} aria-hidden="true" />
      {label}
    </a>
  );
}
