// Status filter tabs used across Appointments, Leads, Approvals, Escalations
// and Conversations. Plain links: the active tab is just a `status` query
// param read server-side by each page, so no client JS is needed.

export type FolderTab = {
  key: string;
  label: string;
  count: number;
  /** Kept for compatibility with existing callers; tabs are one colour now. */
  tone?: string;
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
    <nav aria-label="Filter by status" className="mb-5 overflow-x-auto border-b border-gray-200">
      <div className="flex min-w-max gap-5">
        {tabs.map((tab) => {
          const active = tab.key === activeKey;
          const params = new URLSearchParams(extraParams);
          if (tab.key !== "all") params.set("status", tab.key);
          const qs = params.toString();
          const href = `${basePath}${qs ? `?${qs}` : ""}`;

          return (
            <a
              key={tab.key}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`-mb-px flex items-center gap-1.5 border-b-2 pb-2.5 pt-1 text-[13.5px] no-underline transition-colors ${
                active ? "border-ink font-medium text-ink" : "border-transparent text-gray-500 hover:text-ink"
              }`}
            >
              {tab.label}
              <span className={`tabular text-[12px] ${active ? "text-ink-600" : "text-gray-400"}`}>{tab.count}</span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
