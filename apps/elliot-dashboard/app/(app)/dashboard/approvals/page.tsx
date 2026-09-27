import { createClient } from "@/lib/supabase/server";
import ApprovalCard from "./approval-card";
import FolderTabs, { FolderTab } from "../folder-tabs";

// Real statuses these tables use: "pending" until reviewed, then either
// approve_*_draft() -> "approved" or reject_*_draft() -> "rejected" (see
// approval-card.tsx), plus "auto_sent" for drafts the agent sent without
// needing a human review at all. "blocked_needs_template" only ever comes
// from whatsapp_drafts -- see docs/workflow-specs/27-send-approved-whatsapp.md.
const STATUS_TABS: FolderTab[] = [
  { key: "pending", label: "Pending", count: 0, tone: "warning" },
  { key: "auto_sent", label: "Auto-resolved", count: 0, tone: "violet" },
  { key: "approved", label: "Approved", count: 0, tone: "success" },
  { key: "rejected", label: "Rejected", count: 0, tone: "danger" },
  { key: "blocked_needs_template", label: "Blocked (WhatsApp)", count: 0, tone: "danger" },
];

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: { status?: string; days?: string };
}) {
  const supabase = createClient();

  // RLS scopes both to the logged-in user's tenant automatically -- no
  // manual tenant_id filter needed here as long as each table's RLS policy
  // checks tenant_users via auth_user_id = auth.uid(). Two separate tables
  // (not one), per the decision to keep whatsapp_drafts a sibling of
  // email_drafts rather than merging them -- see migration 0025's header
  // comment. Merged into one list here, in application code, tagged by
  // channel so the card knows which table/RPC/send-webhook to use.
  const [emailResult, whatsappResult] = await Promise.all([
    supabase
      .from("email_drafts")
      .select("id, to_email, subject, body, category, confidence, status, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("whatsapp_drafts")
      .select("id, to_wa_id, body, category, confidence, status, created_at")
      .order("created_at", { ascending: false }),
  ]);

  if (emailResult.error) {
    return <p className="text-sm text-red-700">Failed to load email approvals: {emailResult.error.message}</p>;
  }
  if (whatsappResult.error) {
    return <p className="text-sm text-red-700">Failed to load WhatsApp approvals: {whatsappResult.error.message}</p>;
  }

  const drafts = [
    ...(emailResult.data ?? []).map((d: any) => ({ ...d, channel: "email" as const })),
    ...(whatsappResult.data ?? []).map((d: any) => ({ ...d, channel: "whatsapp" as const })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const days = searchParams.days ? Number(searchParams.days) : null;
  const cutoff = days ? Date.now() - days * 24 * 60 * 60 * 1000 : null;
  const scoped = cutoff ? drafts.filter((d: any) => new Date(d.created_at).getTime() >= cutoff) : drafts;

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
