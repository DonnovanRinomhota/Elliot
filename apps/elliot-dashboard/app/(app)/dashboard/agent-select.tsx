"use client";

import { useRouter, useSearchParams } from "next/navigation";

// Dropdown that switches whose viewings a page shows (?agent=). Keeps the
// page's other settings (week, month, view, status) and goes back to page 1.
export default function AgentSelect({
  options,
  value,
  basePath,
  label = "Agent",
}: {
  options: { value: string; label: string }[];
  value: string;
  basePath: string;
  label?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  return (
    <label className="flex items-center gap-2 text-[13px] text-gray-600">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(params?.toString() ?? "");
          if (e.target.value) next.set("agent", e.target.value);
          else next.delete("agent");
          next.delete("page");
          const qs = next.toString();
          router.push(`${basePath}${qs ? `?${qs}` : ""}`);
        }}
        className="h-9 max-w-[220px] px-3 text-ink"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
