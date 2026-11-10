"use client";

import { usePathname } from "next/navigation";

const TABS = [
  { href: "/platform", label: "Agencies", match: (p: string) => p === "/platform" || p.startsWith("/platform/tenants") },
  { href: "/platform/activity", label: "Activity log", match: (p: string) => p.startsWith("/platform/activity") },
  { href: "/platform/alerts", label: "Health & alerts", match: (p: string) => p.startsWith("/platform/alerts") },
  { href: "/dashboard/onboarding", label: "Add agency", match: () => false },
];

export default function PlatformTabs() {
  const pathname = usePathname() || "";
  return (
    <nav aria-label="Control panel" className="-mb-px flex gap-6">
      {TABS.map((t) => {
        const active = t.match(pathname);
        return (
          <a
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`border-b-2 pb-2.5 pt-1 text-[13.5px] no-underline ${
              active ? "border-white font-medium text-white" : "border-transparent text-ink-200 hover:text-white"
            }`}
          >
            {t.label}
          </a>
        );
      })}
    </nav>
  );
}
