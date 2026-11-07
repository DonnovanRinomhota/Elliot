"use client";

import { useEffect, useState, type ReactNode } from "react";

// Keeps a page's title (and its buttons) visible while the page scrolls.
// Once scrolled, the description is hidden and a hairline appears, so the
// bar stays small. Mobile sits under the top menu bar (about 54px). Status tabs
// (All / Open / Resolved…) go in `tabs` so they stay visible too.
export default function StickyHeader({
  title,
  description,
  actions,
  tabs,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
}) {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={`sticky top-[54px] z-10 -mx-4 bg-[#f5f6f8] px-4 md:top-0 md:-mx-10 md:px-10 ${
        tabs
          ? // The tabs' own bottom line is the divider.
            `mb-5 pb-0 ${stuck ? "pt-3" : "pt-0"}`
          : `mb-6 border-b ${stuck ? "border-gray-200 py-3" : "border-transparent py-0"}`
      }`}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className={`m-0 font-semibold leading-tight tracking-[-0.01em] text-ink ${stuck ? "text-[17px]" : "text-[22px]"}`}>{title}</h1>
          {description && !stuck && <div className="mb-0 mt-1 max-w-2xl text-[13.5px] text-gray-500">{description}</div>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {tabs && <div className={stuck ? "mt-2" : "mt-5"}>{tabs}</div>}
    </div>
  );
}
