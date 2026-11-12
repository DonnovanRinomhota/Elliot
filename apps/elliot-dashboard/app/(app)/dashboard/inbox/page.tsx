import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { contactLabel } from "@/lib/contacts";
import { getMembership } from "@/lib/tenant";
import { Badge, EmptyState, PER_PAGE, PageHeader, Pagination, humanize, paginate, timeAgo, type Tone } from "../../../_ui/ui";
import AutoRefresh from "../auto-refresh";

export const dynamic = "force-dynamic";

const REASON_LABEL: Record<string, string> = {
  hot_lead: "Hot lead",
  customer_requested_human: "Asked for a person",
  angry_customer: "Upset visitor",
  legal_issue: "Legal question",
  refund_requested: "Refund request",
  sensitive_info: "Sensitive information",
  low_confidence: "Elliot wasn't sure",
  no_trusted_source: "No answer found",
  action_exceeds_permissions: "Outside Elliot's rules",
  other: "Needs a person",
};

type Row = {
  id: string;
  channel: string;
  contactName: string;
  contactPhone: string | null;
  state: { label: string; tone: Tone };
  detail: string | null;
  lastMessage: string | null;
  lastAt: string;
  mine: boolean;
};

export default async function InboxPage({ searchParams }: { searchParams: { view?: string; page?: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const [me, { data: handled }, { data: escalations }, { data: live }] = await Promise.all([
    getMembership(supabase, user.id),
    // Taken over by a person.
    supabase
      .from("conversations")
      .select("id, channel, updated_at, assigned_human, handler:tenant_users!conversations_assigned_human_fkey(full_name, email), contact:contacts(name, email, phone)")
      .not("assigned_human", "is", null)
      .order("updated_at", { ascending: false })
      .limit(100),
    // Handed over by Elliot, not resolved yet.
    supabase
      .from("escalations")
      .select("id, reason, priority, context_summary, created_at, conversation:conversations(id, channel, updated_at, assigned_human, contact:contacts(name, email, phone))")
      .neq("status", "resolved")
      .order("created_at", { ascending: false })
      .limit(100),
    // Website chats active in the last 30 minutes, still with Elliot.
    supabase
      .from("conversations")
      .select("id, channel, updated_at, contact:contacts(name, email, phone)")
      .is("assigned_human", null)
      .eq("channel", "chat_widget")
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(50),
  ]);

  const contactName = (c: any, channel?: string) => contactLabel(c, channel || "chat_widget");
  const rows = new Map<string, Row>();

  for (const c of (handled ?? []) as any[]) {
    const mine = Boolean(me && c.assigned_human === me.id);
    rows.set(c.id, {
      id: c.id,
      channel: c.channel,
      contactName: contactName(c.contact, c.channel),
      contactPhone: c.contact?.phone ?? null,
      state: { label: mine ? "You're handling" : `${c.handler?.full_name || c.handler?.email?.split("@")[0] || "A colleague"} is handling`, tone: mine ? "ink" : "neutral" },
      detail: null,
      lastMessage: null,
      lastAt: c.updated_at,
      mine,
    });
  }
  for (const e of (escalations ?? []) as any[]) {
    const c = e.conversation;
    if (!c) continue;
    const existing = rows.get(c.id);
    if (existing) {
      existing.detail = existing.detail ?? e.context_summary;
      continue;
    }
    rows.set(c.id, {
      id: c.id,
      channel: c.channel,
      contactName: contactName(c.contact, c.channel),
      contactPhone: c.contact?.phone ?? null,
      state: { label: REASON_LABEL[e.reason] ?? humanize(e.reason), tone: e.priority === "urgent" || e.priority === "high" || e.reason === "hot_lead" ? "alert" : "brass" },
      detail: e.context_summary,
      lastMessage: null,
      lastAt: c.updated_at || e.created_at,
      mine: false,
    });
  }
  const needsPerson = Array.from(rows.values());
  const liveRows: Row[] = ((live ?? []) as any[])
    .filter((c) => !rows.has(c.id))
    .map((c) => ({
      id: c.id,
      channel: c.channel,
      contactName: contactName(c.contact, c.channel),
      contactPhone: c.contact?.phone ?? null,
      state: { label: "Elliot is answering", tone: "muted" as Tone },
      detail: null,
      lastMessage: null,
      lastAt: c.updated_at,
      mine: false,
    }));

  // Last message of each conversation shown.
  const ids = [...needsPerson, ...liveRows].map((r) => r.id);
  if (ids.length) {
    const { data: msgs } = await supabase
      .from("messages")
      .select("conversation_id, role, content, created_at")
      .in("conversation_id", ids)
      .neq("role", "system")
      .order("created_at", { ascending: false })
      .limit(400);
    const seen = new Set<string>();
    for (const m of (msgs ?? []) as any[]) {
      if (seen.has(m.conversation_id)) continue;
      seen.add(m.conversation_id);
      const r = rows.get(m.conversation_id) ?? liveRows.find((x) => x.id === m.conversation_id);
      if (r) {
        const who = m.role === "user" ? "" : m.role === "assistant" ? "Elliot: " : "Team: ";
        r.lastMessage = who + m.content;
        if (new Date(m.created_at) > new Date(r.lastAt)) r.lastAt = m.created_at;
      }
    }
  }

  const view = searchParams.view === "mine" ? "mine" : "all";
  const sortByTime = (a: Row, b: Row) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
  const shownNeeds = (view === "mine" ? needsPerson.filter((r) => r.mine) : needsPerson).sort(sortByTime);
  const pg = paginate(shownNeeds, searchParams.page);

  return (
    <div>
      <AutoRefresh seconds={15} />
      <PageHeader
        title="Inbox"
        description="Chats that need a person, and website chats happening right now. Open one to take over from Elliot. Updates by itself."
        actions={
          <div className="inline-flex rounded-full border border-gray-200 bg-white p-0.5 text-[13px] shadow-sm">
            {[
              ["all", "Everyone"],
              ["mine", "Mine"],
            ].map(([k, l]) => (
              <a
                key={k}
                href={k === "all" ? "/dashboard/inbox" : "/dashboard/inbox?view=mine"}
                aria-current={view === k ? "page" : undefined}
                className={`rounded-full px-3.5 py-1.5 font-medium no-underline ${view === k ? "bg-ink text-white" : "text-gray-600 hover:text-ink"}`}
              >
                {l}
              </a>
            ))}
          </div>
        }
      />

      <Section
        title="Needs a person"
        count={shownNeeds.length}
        rows={pg.items}
        offset={pg.offset}
        empty={view === "mine" ? "You're not handling any chats." : "Nothing is waiting for a person."}
      />
      {pg.pages > 1 && (
        <div className="-mt-4 mb-8">
          <Pagination {...pg} shown={pg.items.length} basePath="/dashboard/inbox" params={{ view: view === "mine" ? "mine" : undefined }} noun="chats" />
        </div>
      )}
      {view === "all" && (
        <Section title="Live on your website now" count={liveRows.length} rows={liveRows.slice(0, PER_PAGE)} offset={0} empty="No website chats in the last 30 minutes." />
      )}
    </div>
  );
}

function Section({ title, count, rows, offset, empty }: { title: string; count: number; rows: Row[]; offset: number; empty: string }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-[14px] font-semibold text-ink">
        {title} <span className="font-normal text-gray-500">({count})</span>
      </h2>
      {rows.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <ul className="m-0 list-none overflow-hidden card p-0">
          {rows.map((r, i) => (
            <li key={r.id} className="border-t border-gray-100 first:border-t-0">
              <a href={`/dashboard/conversations/${r.id}`} className="block px-4 py-3.5 no-underline hover:bg-gray-50 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="tabular w-6 text-[12.5px] text-gray-400">{offset + i + 1}</span>
                    <span className="truncate text-[14px] font-medium text-ink">{r.contactName}</span>
                    <Badge tone={r.state.tone}>{r.state.label}</Badge>
                  </div>
                  <span className="whitespace-nowrap text-[12.5px] text-gray-500">
                    {humanize(r.channel)} · {timeAgo(r.lastAt)}
                  </span>
                </div>
                {r.detail && <p className="m-0 mt-1 line-clamp-2 text-[13px] text-gray-700">{r.detail}</p>}
                {r.lastMessage && <p className="m-0 mt-1 truncate text-[13px] text-gray-500">{r.lastMessage}</p>}
                {r.contactPhone && <p className="m-0 mt-1 text-[12.5px] text-gray-500">{r.contactPhone}</p>}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
