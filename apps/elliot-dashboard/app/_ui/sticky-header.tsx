"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

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
 * The top of every dashboard page, straight on the page's sky: the section,
 * the title, description, buttons and status tabs. Once it scrolls away, a
 * slim frosted bar with the title, buttons and tabs fades in at the top. The
 * control panel (/platform) has a plainer version under its sticky header.
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
  // The header itself never changes size (a header that shrinks while you
  // scroll changes the page's height, and at the very bottom of a page that
  // makes the browser jump back and forth). Instead, a slim bar fades in over
  // the top once the header has scrolled away.
  const ref = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { rootMargin: "-40px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (pathname.startsWith("/platform")) {
    // The control panel's navy header stays on screen; the page title scrolls.
    return (
      <div className={`${tabs ? "mb-5" : "mb-6"}`}>
        {back}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="m-0 text-[30px] font-semibold leading-tight tracking-[-0.03em] text-ink">{title}</h1>
            {description && <div className="mb-0 mt-1.5 max-w-2xl text-[14px] text-gray-600">{description}</div>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
        {tabs && <div className="mt-5">{tabs}</div>}
      </div>
    );
  }

  const section = SECTIONS.find(([p]) => pathname.startsWith(p))?.[1];

  return (
    <>
      <div ref={ref} data-band className="relative z-10 mb-6 pt-1 text-white md:pt-2">
        {back && <div className="mb-3">{back}</div>}
        {section && (
          <p className="m-0 mb-3 flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.24em] text-white/80">
            <span aria-hidden="true" className="h-px w-8 bg-white/60" />
            {section}
          </p>
        )}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="m-0 text-[30px] font-medium leading-[1.1] tracking-[-0.035em] md:text-[36px]">{title}</h1>
            {description && <div className="mb-0 mt-2 max-w-2xl text-[14.5px] text-white/80 [&_a]:text-white">{description}</div>}
          </div>
          {actions && <div className="band-actions flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {tabs && <div className="mt-6">{tabs}</div>}
      </div>

      {/* The slim bar (computers only), over the top of the page once the header is gone. */}
      <div
        data-band
        aria-hidden={!stuck}
        className={`glass-dark fixed left-[256px] right-0 top-0 z-30 hidden border-b px-6 py-3 text-white shadow-[0_14px_30px_-18px_rgba(2,12,32,0.8)] transition-[opacity,transform] duration-200 md:block lg:px-9 ${
          stuck ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0"
        }`}
        {...(stuck ? {} : { inert: "" as unknown as boolean })}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 className="m-0 truncate text-[18px] font-medium tracking-[-0.02em]">{title}</h2>
          {actions && <div className="band-actions flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {tabs && <div className="mt-2.5">{tabs}</div>}
      </div>
    </>
  );
}
