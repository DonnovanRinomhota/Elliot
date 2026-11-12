"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

// Which part of the menu a page belongs to, for the small line above its title.
const SECTIONS: [prefix: string, section: string][] = [
  ["/dashboard/inbox", "Needs attention"],
  ["/dashboard/escalations", "Needs attention"],
  ["/dashboard/approvals", "Needs attention"],
  ["/dashboard/leads", "Customers"],
  ["/dashboard/appointments", "Customers"],
  ["/dashboard/calendar", "Customers"],
  ["/dashboard/conversations", "Customers"],
  ["/dashboard/follow-ups", "Customers"],
  ["/dashboard/listings", "Your agency"],
  ["/dashboard/knowledge", "Your agency"],
  ["/dashboard/team", "Your agency"],
  ["/dashboard/settings", "Your agency"],
  ["/dashboard/onboarding", "Getting started"],
];

/**
 * The top of every dashboard page, in the website's colours: a navy sky band
 * with the title, description, buttons and status tabs. Once the page
 * scrolls it folds into a slim navy bar that stays on screen with the title,
 * buttons and tabs. The control panel (/platform) keeps a plain light header.
 */
export default function StickyHeader({
  title,
  description,
  actions,
  tabs,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  back?: ReactNode;
}) {
  const pathname = usePathname() || "";
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (pathname.startsWith("/platform")) {
    return (
      <div
        className={`sticky top-0 z-10 -mx-4 px-4 md:-mx-8 md:px-8 ${stuck ? "bg-[#eef2f8]/90 backdrop-blur-md" : ""} ${
          tabs ? `mb-5 ${stuck ? "pt-3" : ""}` : `mb-6 border-b ${stuck ? "border-gray-200 py-3" : "border-transparent"}`
        }`}
      >
        {back}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className={`m-0 font-semibold leading-tight tracking-[-0.03em] text-ink ${stuck ? "text-[17px]" : "text-[30px]"}`}>{title}</h1>
            {description && !stuck && <div className="mb-0 mt-1.5 max-w-2xl text-[14px] text-gray-600">{description}</div>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
        {tabs && <div className={stuck ? "mt-2 pb-3" : "mt-5"}>{tabs}</div>}
      </div>
    );
  }

  const section = SECTIONS.find(([p]) => pathname.startsWith(p))?.[1];

  return (
    <div
      data-band
      className={`sky relative z-10 md:sticky md:top-0 -mx-4 -mt-6 mb-6 px-4 text-white transition-[padding] md:-mx-6 md:-mt-7 md:px-6 lg:-mx-7 lg:px-9 ${
        stuck ? "py-3 shadow-[0_14px_30px_-18px_rgba(3,24,58,0.7)]" : "pb-8 pt-7 md:pb-10 md:pt-9"
      }`}
    >
      {back && !stuck && <div className="mb-3">{back}</div>}
      {!stuck && section && (
        <p className="m-0 mb-3 flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.24em] text-white/80">
          <span aria-hidden="true" className="h-px w-8 bg-white/60" />
          {section}
        </p>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className={`m-0 font-medium leading-[1.1] tracking-[-0.035em] ${stuck ? "text-[18px]" : "text-[30px] md:text-[36px]"}`}>{title}</h1>
          {description && !stuck && <div className="mb-0 mt-2 max-w-2xl text-[14.5px] text-white/80 [&_a]:text-white">{description}</div>}
        </div>
        {actions && <div className="band-actions flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs && <div className={stuck ? "mt-2.5" : "mt-6"}>{tabs}</div>}
    </div>
  );
}
