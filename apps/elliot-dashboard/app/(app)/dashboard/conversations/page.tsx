import { createClient } from "@/lib/supabase/server";
import FolderTabs, { FolderTab } from "../folder-tabs";
import { EmptyState, PageHeader, StatusBadge, humanize, timeAgo } from "../../../_ui/ui";

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: { status?: string; days?: string; date?: string };
}) {
  const supabase = createClient();

  const { data: conversations, error } = await supabase
    .from("conversations")
    .select("id, channel, status, created_at, contact:contacts(name, email)")
    .order("created_at", { ascending: false });

  if (error) {
    return <p className="text-[13px] text-alert">Couldn&apos;t load conversations: {error.message}</p>;
  }

  let scoped = conversations ?? [];

  const days = searchParams.days ? Number(searchParams.days) : null;
  if (days) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    scoped = scoped.filter((c: any) => new Date(c.created_at).getTime() >= cutoff);
  }
  if (searchParams.date) {
    scoped = scoped.filter((c: any) => c.created_at.slice(0, 10) === searchParams.date);
  }

  // Status folders reflect whatever statuses this tenant's conversations
  // actually have -- not hardcoded, since the fixed set isn't defined
  // anywhere in this app's frontend code.
  const STATUS_ORDER = ["open", "escalated", "closed"];
  const distinctStatuses = Array.from(new Set((conversations ?? []).map((c: any) => c.status as string))).sort(
    (a, b) => (STATUS_ORDER.indexOf(a) + 1 || 99) - (STATUS_ORDER.indexOf(b) + 1 || 99)
  );
  const STATUS_TABS: FolderTab[] = distinctStatuses.map((s) => ({ key: s, label: humanize(s), count: 0 }));

  const tabs: FolderTab[] = [
    { key: "all", label: "All", count: scoped.length, tone: "neutral" },
    ...STATUS_TABS.map((t) => ({ ...t, count: scoped.filter((c: any) => c.status === t.key).length })),
  ];

  const activeStatus = tabs.some((t) => t.key === searchParams.status) ? (searchParams.status as string) : "all";
  const visible = activeStatus === "all" ? scoped : scoped.filter((c: any) => c.status === activeStatus);

  const extraParams: Record<string, string> = {};
  if (days) extraParams.days = String(days);
  if (searchParams.date) extraParams.date = searchParams.date;

  const filterLabel = searchParams.date
    ? new Date(`${searchParams.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
    : days
      ? `the last ${days} days`
      : null;

  return (
    <div>
      <PageHeader
        title="Conversations"
        description={
          filterLabel ? (
            <>
              {scoped.length} conversation{scoped.length === 1 ? "" : "s"} from {filterLabel}.{" "}
              <a href="/dashboard/conversations" className="text-ink underline">
                Show all
              </a>
            </>
          ) : (
            "Every chat and email thread Elliot has had with your clients."
          )
        }
      />

      <FolderTabs tabs={tabs} activeKey={activeStatus} basePath="/dashboard/conversations" extraParams={extraParams} />

      {visible.length === 0 ? (
        <EmptyState title="No conversations here">Conversations appear as soon as someone writes to Elliot.</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="hidden grid-cols-[minmax(0,2fr)_140px_120px_140px] gap-4 border-b border-gray-200 bg-gray-50 px-5 py-2.5 text-[12px] font-medium text-gray-500 md:grid">
            <span>Contact</span>
            <span>Channel</span>
            <span>Status</span>
            <span>Started</span>
          </div>
          <ul className="m-0 list-none p-0">
            {visible.map((c: any) => (
              <li key={c.id} className="border-t border-gray-200 first:border-t-0">
                <a
                  href={`/dashboard/conversations/${c.id}`}
                  className="grid gap-1 px-5 py-3.5 no-underline hover:bg-gray-50 md:grid-cols-[minmax(0,2fr)_140px_120px_140px] md:items-center md:gap-4"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-medium text-ink">
                      {c.contact?.name || c.contact?.email || "Unknown contact"}
                    </span>
                    {c.contact?.name && c.contact?.email && <span className="block truncate text-[12.5px] text-gray-500">{c.contact.email}</span>}
                  </span>
                  <span className="text-[13px] text-gray-600">{humanize(c.channel)}</span>
                  <span>
                    <StatusBadge kind="conversation" value={c.status} />
                  </span>
                  <span className="text-[13px] text-gray-500">{timeAgo(c.created_at)}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
