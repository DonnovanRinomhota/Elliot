"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export default function NavLink({
  href,
  icon,
  label,
  badge,
  badgeTone = "neutral",
}: {
  href: string;
  icon?: ReactNode;
  label: string;
  badge?: number | null;
  badgeTone?: "neutral" | "danger" | "warning";
}) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/" && pathname?.startsWith(href));

  const badgeClass = {
    neutral: "bg-gray-100 text-gray-600",
    danger: "bg-alert text-white",
    warning: "bg-brass-soft text-brass-dark",
  }[badgeTone];

  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative flex h-9 items-center gap-2.5 rounded-xl px-3 text-[13.5px] no-underline transition-colors ${
        active ? "bg-accent-soft font-medium text-accent-dark" : "text-gray-600 hover:bg-gray-50 hover:text-ink"
      }`}
    >
      {icon && <span className={active ? "text-accent" : "text-gray-400"}>{icon}</span>}
      <span className="truncate">{label}</span>
      {badge != null && badge > 0 && (
        <span className={`tabular ml-auto min-w-[22px] rounded-full px-1.5 text-center text-[11.5px] font-semibold leading-5 ${badgeClass}`}>
          {badge}
        </span>
      )}
    </a>
  );
}
