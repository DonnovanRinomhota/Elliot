"use client";

import { useEffect, useState, type ReactNode } from "react";

// Keeps a page's title (and its buttons) visible while the page scrolls.
// Once scrolled, the description is hidden and a hairline appears, so the
// bar stays small. Mobile sits under the 57px top menu bar.
export default function StickyHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={`sticky top-[57px] z-10 -mx-4 mb-6 bg-[#f5f6f8]/95 px-4 backdrop-blur md:top-0 md:-mx-10 md:px-10 ${
        stuck ? "border-b border-gray-200 py-3" : "border-b border-transparent py-0"
      }`}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className={`m-0 font-semibold leading-tight tracking-[-0.01em] text-ink ${stuck ? "text-[17px]" : "text-[22px]"}`}>{title}</h1>
          {description && !stuck && <div className="mb-0 mt-1 max-w-2xl text-[13.5px] text-gray-500">{description}</div>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
