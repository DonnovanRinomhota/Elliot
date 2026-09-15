import { createClient } from "@/lib/supabase/server";
import ApprovalCard from "./approval-card";
import FolderTabs, { FolderTab } from "../folder-tabs";

// Real statuses this table uses: "pending" until reviewed, then either
// approve_email_draft() -> "approved" or reject_email_draft() -> "rejected"
// (see approval-card.tsx), plus "auto_sent" for drafts the agent sent
// without needing a human review at all.
const STATUS_TABS: FolderTab[] = [
  { key: "pending", label: "Pending", count: 0, tone: "warning" },
  { key: "auto_sent", label: "Auto-resolved", count: 0, tone: "violet" },
  { key: "approved", label: "Approved", count: 0, tone: "success" },
  { key: "rejected", label: "Rejected", count: 0, tone: "danger" },
];

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: { status?: string; days?: string };
}) {
  const supabase = createClient();

  // RLS scopes this to the logged-in user's tenant automatically -- no manual
  // tenant_id filter needed here as long as email_drafts' RLS policy checks
  // tenant_users via auth_user_id = auth.uid().
  const { data: drafts, error } = await supabase
    .from("email_drafts")
    .select("id, to_email, subject, body, category, confidence, status, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return <p className="text-sm text-red-700">Failed to load approvals: {error.message}</p>;
  }

  const days = searchParams.days ? Number(searchParams.days) : null;
  const cutoff = days ? Date.now() - days * 24 * 60 * 60 * 1000 : null;
  const scoped = cutoff ? (drafts ?? []).filter((d: any) => new Date(d.created_at).getTime() >= cutoff) : drafts ?? [];

  const tabs: FolderTab[] = [
    { key: "all", label: "All", count: scoped.length, tone: "neutral" },
    ...STATUS_TABS.map((t) => ({ ...t, count: scoped.filter((d: any) => d.status === t.key).length })),
  ];

  // Defaults to "pending" (not "all") so a plain sidebar click still lands
  // on the actionable queue, same as this page always behaved before.
  const activeStatus = tabs.some((t) => t.key === searchParams.status) ? (searchParams.status as string) : "pending";
  const visible = activeStatus === "all" ? scoped : scoped.filter((d: any) => d.status === activeStatus);

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold text-ink">Approvals</h1>
      <p className="mb-4 text-sm text-gray-500">
        {scoped.length} total this view
        {days && (
          <>
            {" "}
            · filtered to the last {days} days ·{" "}
            <a href="/dashboard/approvals" className="text-indigo-600 hover:underline">
              clear filter
            </a>
          </>
        )}
      </p>

      <FolderTabs
        tabs={tabs}
        activeKey={activeStatus}
        basePath="/dashboard/approvals"
        extraParams={days ? { days: String(days) } : {}}
      />

      {visible.length === 0 && <p className="text-sm text-gray-400">Nothing in this folder.</p>}

      <div className="flex flex-col gap-4">
        {visible.map((draft: any) => (
          <ApprovalCard key={draft.id} draft={draft} />
        ))}
      </div>
    </div>
  );
}
