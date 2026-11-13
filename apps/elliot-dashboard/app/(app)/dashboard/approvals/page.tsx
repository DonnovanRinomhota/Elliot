import { createClient } from "@/lib/supabase/server";
import { draftTimeline, inboundFor, stamp, type InboundMessage } from "@/lib/approvals";
import { DEFAULT_TZ } from "@/lib/appointments";
import ApprovalCard from "./approval-card";
import RejectSpamButton from "./reject-spam-button";
import { ElliotMark } from "../../../_ui/elliot-logo";
import FolderTabs, { FolderTab } from "../folder-tabs";
import { timeAgo, EmptyState, FilterDescription, PageHeader, Pagination, paginate } from "../../../_ui/ui";

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
  // Clients' drafts are the work; spam and automatic ones are folded away
  // underneath (or listed on their own with show=spam).
  const visible = onlySpam ? inTab.filter(isSpam) : inTab.filter((d: any) => !isSpam(d));
  const foldedSpam = onlySpam ? [] : inTab.filter(isSpam);
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
            ["From clients", !onlySpam, `/dashboard/approvals${activeStatus !== "pending" ? `?status=${activeStatus}` : ""}`],
            ["Only spam and automatic", onlySpam, `/dashboard/approvals?show=spam${activeStatus !== "pending" ? `&status=${activeStatus}` : ""}`],
          ].map(([label, on, href]) => (
            <a
              key={label as string}
              href={href as string}
              aria-current={on ? "page" : undefined}
              className={`inline-flex h-9 items-center rounded-full border px-4 no-underline ${on ? "border-white bg-[#fff] font-medium text-navy" : "border-gray-200 bg-glass text-ink hover:bg-glass-hi"}`}
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
        <EmptyState title={activeStatus === "pending" ? (onlySpam ? "No spam waiting" : "No client drafts waiting") : "Nothing here"}>
          {activeStatus === "pending" ? "New drafts appear here when Elliot needs your approval to send." : null}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
          {cards.map((draft: any) => (
            <ApprovalCard key={draft.id} draft={draft} />
          ))}
        </div>
      )}
      {foldedSpam.length > 0 && (
        <details className="fold card mt-5">
          <summary className="px-5 py-4">
            <span className="text-[15.5px] font-semibold text-ink">Spam and automatic emails</span>
            <span className="tabular rounded-full bg-gray-100 px-2 py-0.5 text-[12px] font-bold text-gray-600">{foldedSpam.length}</span>
            <span className="text-[13px] text-gray-500">Not clients. Elliot suggests rejecting them.</span>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="fold-chevron flex-shrink-0 text-gray-500">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </summary>
          <div className="border-t border-white/10 px-5 pb-5 pt-3">
            <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-1.5 p-0">
              {foldedSpam.slice(0, 12).map((d: any) => (
                <li key={d.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-glass px-3 py-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate text-ink">{d.to_email || d.to_wa_id}</span>
                  <span className="hidden min-w-0 flex-1 truncate text-gray-500 md:block">{d.subject || "(no subject)"}</span>
                  <span className="whitespace-nowrap text-[12px] text-gray-500">{timeAgo(d.created_at)}</span>
                </li>
              ))}
            </ul>
            <a href={`/dashboard/approvals?show=spam${activeStatus !== "pending" ? `&status=${activeStatus}` : ""}`} className="mt-3 inline-block text-[13px] font-semibold text-brass-dark no-underline hover:text-ink">
              Review {foldedSpam.length > 12 ? `all ${foldedSpam.length}` : "them"} one by one →
            </a>
          </div>
        </details>
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
