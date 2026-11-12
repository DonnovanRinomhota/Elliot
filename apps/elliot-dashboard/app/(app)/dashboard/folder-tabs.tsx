// Status filter tabs used across Appointments, Leads, Approvals, Escalations
// and Conversations. Plain links: the active tab is just a `status` query
// param read server-side by each page, so no client JS is needed.
// Pass them to PageHeader as `tabs`: they sit on its navy band and stay on
// screen while scrolling.

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
  defaultKey = "all",
}: {
  tabs: FolderTab[];
  activeKey: string;
  basePath: string;
  extraParams?: Record<string, string>;
  /** The tab the page shows when there's no status in the address (Approvals: "pending"). */
  defaultKey?: string;
}) {
  return (
    <nav aria-label="Filter by status" className="-mx-1 overflow-x-auto px-1 pb-1">
      <div className="flex min-w-max gap-2">
        {tabs.map((tab) => {
          const active = tab.key === activeKey;
          const params = new URLSearchParams(extraParams);
          // The default tab needs no status; every other tab must say which it is
          // (Approvals defaults to "pending", so its "All" link needs status=all).
          if (tab.key !== defaultKey) params.set("status", tab.key);
          const qs = params.toString();
          const href = `${basePath}${qs ? `?${qs}` : ""}`;

          // Chips on the page's navy band: white when chosen, glass otherwise.
          return (
            <a
              key={tab.key}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13.5px] no-underline transition-colors ${
                active ? "border-white bg-white font-medium text-ink" : "border-white/25 bg-[#071a3a]/45 text-white backdrop-blur-sm hover:bg-[#071a3a]/65"
              }`}
            >
              {tab.label}
              <span className={`tabular text-[12.5px] font-bold ${active ? "text-ink" : "text-white"}`}>{tab.count}</span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
