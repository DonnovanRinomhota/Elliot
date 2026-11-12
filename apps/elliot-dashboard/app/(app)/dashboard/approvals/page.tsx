import { createClient } from "@/lib/supabase/server";
import { draftTimeline, inboundFor, stamp, type InboundMessage } from "@/lib/approvals";
import { DEFAULT_TZ } from "@/lib/appointments";
import ApprovalCard from "./approval-card";
import RejectSpamButton from "./reject-spam-button";
import { ElliotMark } from "../../../_ui/elliot-logo";
import FolderTabs, { FolderTab } from "../folder-tabs";
import { EmptyState, FilterDescription, PageHeader, Pagination, paginate } from "../../../_ui/ui";

// Real statuses these tables use: "pending" until reviewed, then either
// approve_*_draft() -> "approved" or reject_*_draft() -> "rejected" (see
// approval-card.tsx), plus "auto_sent" for drafts the agent sent without
// needing a human review at all. "blocked_needs_template" only ever comes
// from whatsapp_drafts -- see docs/workflow-specs/27-send-approved-whatsapp.md.
const STATUS_TABS: FolderTab[] = [
  { key: "pending", label: "Waiting", count: 0, tone: "warning" },
  { key: "sent", label: "Sent", count: 0, tone: "success" },
  { key: "auto_sent", label: "Sent automatically", count: 0, tone: "neutral" },
  { key: "approved", label: "Approved, sending", count: 0, tone: "success" },
  { key: "rejected", label: "Rejected", count: 0, tone: "danger" },
  { key: "blocked_needs_template", label: "Blocked on WhatsApp", count: 0, tone: "danger" },
];

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: { status?: string; days?: string; page?: string; show?: string };
}) {
  const supabase = createClient();

  // RLS scopes both to the logged-in user's tenant automatically -- no
  // manual tenant_id filter needed here as long as each table's RLS policy
  // checks tenant_users via auth_user_id = auth.uid(). Two separate tables
  // (not one), per the decision to keep whatsapp_drafts a sibling of
  // email_drafts rather than merging them -- see migration 0025's header
  // comment. Merged into one list here, in application code, tagged by
  // channel so the card knows which table/RPC/send-webhook to use.
  const [emailResult, whatsappResult, { data: tenant }] = await Promise.all([
    supabase
      .from("email_drafts")
      .select("id, conversation_id, to_email, subject, body, category, confidence, status, created_at, reviewed_at, sent_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("whatsapp_drafts")
      .select("id, conversation_id, to_wa_id, body, category, confidence, status, created_at, reviewed_at, sent_at, last_inbound_at, send_error")
      .order("created_at", { ascending: false }),
    supabase.from("tenants").select("timezone").maybeSingle(),
  ]);
  const tz = (tenant as { timezone?: string } | null)?.timezone || DEFAULT_TZ;

  if (emailResult.error) {
    return <p className="text-[13px] text-alert">Couldn&apos;t load email drafts: {emailResult.error.message}</p>;
  }
  if (whatsappResult.error) {
    return <p className="text-[13px] text-alert">Couldn&apos;t load WhatsApp drafts: {whatsappResult.error.message}</p>;
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
  const inTab = activeStatus === "all" ? scoped : scoped.filter((d: any) => d.status === activeStatus);

  // Elliot classes replies to automatic emails (notifications, newsletters) as
  // spam. Clients come first; "show=spam" lists only the spam ones.
  const isSpam = (d: any) => d.category === "spam";
  const spamWaiting = scoped.filter((d: any) => d.status === "pending" && isSpam(d)).length;
  const clientCount = inTab.filter((d: any) => !isSpam(d)).length;
  const spamCount = inTab.length - clientCount;
  const onlySpam = searchParams.show === "spam";
  const visible = onlySpam ? inTab.filter(isSpam) : [...inTab.filter((d: any) => !isSpam(d)), ...inTab.filter(isSpam)];
  const pg = paginate(visible, searchParams.page);

  // The client's message each draft on this page answers, and the dates.
  const conversationIds = [...new Set(pg.items.map((d: any) => d.conversation_id).filter(Boolean))] as string[];
  const { data: inbound } = conversationIds.length
    ? await supabase
        .from("messages")
        .select("conversation_id, content, created_at")
        .in("conversation_id", conversationIds)
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(500)
    : { data: [] as InboundMessage[] };
  const cards = pg.items.map((d: any) => {
    const msg = inboundFor(d, (inbound ?? []) as InboundMessage[]);
    const receivedAt = msg?.created_at ?? d.last_inbound_at ?? null;
    return {
      ...d,
      timeline: draftTimeline(d, tz, receivedAt),
      inbound: msg ? { content: msg.content, at: stamp(msg.created_at, tz) } : null,
    };
  });

  return (
    <div>
      <PageHeader
        title="Approvals"
        description={
          <FilterDescription days={days} count={scoped.length} noun={["draft", "drafts"]} clearHref="/dashboard/approvals">
            Drafts waiting for your OK, with the client&apos;s message and when it came in. Nothing is sent until you approve it, and you can edit a draft first.
          </FilterDescription>
        }
        tabs={
          <FolderTabs
            tabs={tabs}
            activeKey={activeStatus}
            basePath="/dashboard/approvals"
            defaultKey="pending"
            extraParams={days ? { days: String(days) } : {}}
          />
        }
      />

      {activeStatus === "pending" && spamWaiting > 0 && (
        <section className="mb-5 flex flex-wrap items-center gap-4 rounded-[22px] bg-[linear-gradient(135deg,#071631,#14325c_60%,#2b5590)] px-5 py-4 text-white shadow-lift">
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[#0b1426] shadow-[0_0_0_1px_rgba(217,165,108,0.6),0_0_18px_rgba(217,165,108,0.35)]">
            <ElliotMark size={21} />
          </span>
          <div className="min-w-0 flex-1 basis-[240px]">
            <p className="m-0 text-[16px] font-semibold">
              {spamWaiting === scoped.filter((d: any) => d.status === "pending").length
                ? `All ${spamWaiting} waiting drafts are replies to spam and automatic emails.`
                : `${spamWaiting} of the ${scoped.filter((d: any) => d.status === "pending").length} waiting drafts are replies to spam and automatic emails.`}
            </p>
            <p className="m-0 mt-0.5 text-[13.5px] text-white/75">
              Notifications, newsletters and the like, not clients. Reject them in one go; nothing is sent.{" "}
              <a href={onlySpam ? "/dashboard/approvals" : "/dashboard/approvals?show=spam"} className="text-white underline">
                {onlySpam ? "Show clients first" : "See them first"}
              </a>
            </p>
          </div>
          <RejectSpamButton count={spamWaiting} />
        </section>
      )}

      {inTab.length > 0 && spamCount > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px]">
          {[
            ["Clients first", !onlySpam, `/dashboard/approvals${activeStatus !== "pending" ? `?status=${activeStatus}` : ""}`],
            ["Only spam and automatic", onlySpam, `/dashboard/approvals?show=spam${activeStatus !== "pending" ? `&status=${activeStatus}` : ""}`],
          ].map(([label, on, href]) => (
            <a
              key={label as string}
              href={href as string}
              aria-current={on ? "page" : undefined}
              className={`inline-flex h-9 items-center rounded-full border px-4 no-underline ${on ? "border-ink bg-ink font-medium text-white" : "border-gray-200 bg-white text-ink hover:bg-gray-50"}`}
            >
              {label as string}
            </a>
          ))}
          <span className="ml-auto text-gray-500">
            {clientCount} from clients · {spamCount} spam or automatic
          </span>
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState title={activeStatus === "pending" ? "You're all caught up" : "Nothing here"}>
          {activeStatus === "pending" ? "New drafts appear here when Elliot needs your approval to send." : null}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
          {cards.map((draft: any) => (
            <ApprovalCard key={draft.id} draft={draft} />
          ))}
        </div>
      )}
      <Pagination
        {...pg}
        shown={pg.items.length}
        basePath="/dashboard/approvals"
        params={{ days: days ? String(days) : undefined, status: activeStatus, show: onlySpam ? "spam" : undefined }}
        noun="drafts"
      />
    </div>
  );
}
