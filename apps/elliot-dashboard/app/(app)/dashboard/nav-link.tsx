"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// A link in the navy sidebar. The page you're on is marked in gold, as on
// the website.
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
    neutral: "bg-white/15 text-white",
    danger: "bg-[#d9483d] text-white",
    warning: "gold-fill text-navy",
  }[badgeTone];

  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative flex h-10 items-center gap-3 rounded-xl px-3 text-[13.5px] no-underline transition-colors ${
        active
          ? "bg-[linear-gradient(90deg,rgba(217,165,108,0.22),rgba(217,165,108,0.06))] font-semibold text-gold-light shadow-[inset_0_0_0_1px_rgba(217,165,108,0.28)]"
          : "text-white/75 hover:bg-glass-hi/[0.07] hover:text-white"
      }`}
    >
      {active && <span aria-hidden="true" className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-r bg-gold shadow-[0_0_12px_#d9a56c]" />}
      {icon && <span className={active ? "text-gold-light" : "text-white/60"}>{icon}</span>}
      <span className="truncate">{label}</span>
      {badge != null && badge > 0 && (
        <span className={`tabular ml-auto min-w-[22px] rounded-full px-1.5 text-center text-[11.5px] font-bold leading-5 ${badgeClass}`}>{badge}</span>
      )}
    </a>
  );
}
