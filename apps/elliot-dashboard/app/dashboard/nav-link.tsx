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
  icon: ReactNode;
  label: string;
  badge?: number | null;
  badgeTone?: "neutral" | "danger" | "warning";
}) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/" && pathname?.startsWith(href));

  const badgeColors = {
    neutral: { bg: "#eee", color: "#444" },
    danger: { bg: "#fde2e2", color: "#a11" },
    warning: { bg: "#fdf0d5", color: "#8a5a00" },
  }[badgeTone];

  return (
    <a
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 8px",
        borderRadius: 7,
        fontSize: 13,
        fontWeight: active ? 500 : 400,
        background: active ? "#eef0f3" : "transparent",
        color: active ? "#111" : "#444",
        textDecoration: "none",
      }}
    >
      {icon}
      {label}
      {badge != null && badge > 0 && (
        <span
          style={{
            marginLeft: "auto",
            background: badgeColors.bg,
            color: badgeColors.color,
            fontSize: 10,
            fontWeight: 500,
            padding: "1px 6px",
            borderRadius: 8,
          }}
        >
          {badge}
        </span>
      )}
    </a>
  );
}
