// Shared "ticketing system" folder tabs used across Appointments, Leads,
// Approvals, Escalations, and Conversations. Plain anchor links (not a
// client component) -- the active folder is just a `status` query param,
// read server-side by each page, so no client state/JS needed here.

export type FolderTab = {
  key: string;
  label: string;
  count: number;
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "violet";
};

const TONE_STYLES: Record<string, { activeBorder: string; activeText: string; badgeActive: string }> = {
  neutral: { activeBorder: "border-ink", activeText: "text-ink", badgeActive: "bg-gray-100 text-gray-700" },
  success: { activeBorder: "border-pulse-dark", activeText: "text-pulse-dark", badgeActive: "bg-pulse-soft text-pulse-dark" },
  warning: { activeBorder: "border-amber-dark", activeText: "text-amber-dark", badgeActive: "bg-amber-soft text-amber-dark" },
  danger: { activeBorder: "border-coral-dark", activeText: "text-coral-dark", badgeActive: "bg-coral-soft text-coral-dark" },
  info: { activeBorder: "border-indigo-600", activeText: "text-indigo-600", badgeActive: "bg-indigo-50 text-indigo-600" },
  violet: { activeBorder: "border-violet-600", activeText: "text-violet-600", badgeActive: "bg-violet-50 text-violet-600" },
};

export default function FolderTabs({
  tabs,
  activeKey,
  basePath,
  extraParams = {},
}: {
  tabs: FolderTab[];
  activeKey: string;
  basePath: string;
  extraParams?: Record<string, string>;
}) {
  return (
    <div className="mb-6 flex flex-wrap gap-1 border-b border-gray-200">
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        const tone = TONE_STYLES[tab.tone || "neutral"];

        const params = new URLSearchParams(extraParams);
        if (tab.key !== "all") params.set("status", tab.key);
        const qs = params.toString();
        const href = `${basePath}${qs ? `?${qs}` : ""}`;

        return (
          <a
            key={tab.key}
            href={href}
            className={`flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold no-underline transition ${
              active ? `${tone.activeBorder} ${tone.activeText}` : "border-transparent text-gray-500 hover:text-ink hover:border-gray-200"
            }`}
          >
            {tab.label}
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                active ? tone.badgeActive : "bg-gray-100 text-gray-500"
              }`}
            >
              {tab.count}
            </span>
          </a>
        );
      })}
    </div>
  );
}
