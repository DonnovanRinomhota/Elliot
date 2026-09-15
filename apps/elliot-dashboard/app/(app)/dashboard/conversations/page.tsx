import { createClient } from "@/lib/supabase/server";
import FolderTabs, { FolderTab } from "../folder-tabs";

const TAB_TONES: FolderTab["tone"][] = ["info", "success", "warning", "danger", "violet", "neutral"];

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
    return <p className="text-sm text-red-700">Failed to load conversations: {error.message}</p>;
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
  const distinctStatuses = Array.from(new Set((conversations ?? []).map((c: any) => c.status))).sort();
  const STATUS_TABS: FolderTab[] = distinctStatuses.map((s, i) => ({
    key: s,
    label: s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " "),
    count: 0,
    tone: TAB_TONES[i % TAB_TONES.length],
  }));

  const tabs: FolderTab[] = [
    { key: "all", label: "All", count: scoped.length, tone: "neutral" },
    ...STATUS_TABS.map((t) => ({ ...t, count: scoped.filter((c: any) => c.status === t.key).length })),
  ];

  const activeStatus = tabs.some((t) => t.key === searchParams.status) ? (searchParams.status as string) : "all";
  const visible = activeStatus === "all" ? scoped : scoped.filter((c: any) => c.status === activeStatus);

  const extraParams: Record<string, string> = {};
  if (days) extraParams.days = String(days);
  if (searchParams.date) extraParams.date = searchParams.date;

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold text-ink">Conversations</h1>
      <p className="mb-4 text-sm text-gray-500">
        {scoped.length} conversation{scoped.length === 1 ? "" : "s"}
        {(days || searchParams.date) && (
          <>
            {" "}
            ·{" "}
            {searchParams.date
              ? `filtered to ${new Date(`${searchParams.date}T00:00:00Z`).toLocaleDateString("en-GB", {
                  dateStyle: "medium",
                  timeZone: "UTC",
                })}`
              : `filtered to the last ${days} days`}{" "}
            ·{" "}
            <a href="/dashboard/conversations" className="text-indigo-600 hover:underline">
              clear filter
            </a>
          </>
        )}
      </p>

      <FolderTabs tabs={tabs} activeKey={activeStatus} basePath="/dashboard/conversations" extraParams={extraParams} />

      {visible.length === 0 && <p className="text-sm text-gray-400">No conversations in this folder.</p>}

      <div className="flex flex-col gap-2">
        {visible.map((c: any) => (
          <a
            key={c.id}
            href={`/dashboard/conversations/${c.id}`}
            className="flex items-center justify-between rounded-xl border border-gray-100 bg-white px-5 py-3.5 text-ink no-underline shadow-sm transition hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-md"
          >
            <div>
              <strong className="font-semibold">{c.contact?.name || c.contact?.email || "Unknown contact"}</strong>
              <span className="ml-2 text-xs text-gray-400">
                {c.channel} · {c.status}
              </span>
            </div>
            <span className="text-xs text-gray-400">{new Date(c.created_at).toLocaleString("en-GB", { timeZone: "UTC" })}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
