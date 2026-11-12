import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { contactLabel } from "@/lib/contacts";
import { getMembership } from "@/lib/tenant";
import { ArrowRight, Phone, Radio, UserCheck, Users } from "lucide-react";
import { Badge, PER_PAGE, PageHeader, Pagination, btn, humanize, paginate, timeAgo, type Tone } from "../../../_ui/ui";
import { ChannelTile } from "../../../_ui/brands";
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

      {/* At a glance */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: "Waiting for a person", value: needsPerson.filter((r) => r.state.tone !== "ink" && r.state.tone !== "neutral").length, icon: Users, tone: "text-alert-dark" },
          { label: "You're handling", value: needsPerson.filter((r) => r.mine).length, icon: UserCheck, tone: "text-ink" },
          { label: "Live on your website", value: liveRows.length, icon: Radio, tone: "text-[#237a49]" },
        ].map((f) => {
          const Icon = f.icon;
          return (
            <div key={f.label} className="card flex items-center gap-3 px-4 py-3.5">
              <span className="gold-tile h-10 w-10 rounded-xl">
                <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] text-gray-600">{f.label}</span>
                <span className={`tabular block text-[24px] font-semibold leading-tight tracking-[-0.02em] ${f.tone}`}>{f.value}</span>
              </span>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div>
          <Section
            title="Needs a person"
            count={shownNeeds.length}
            rows={pg.items}
            empty={view === "mine" ? "You're not handling any chats." : "Nothing is waiting for a person."}
          />
          {pg.pages > 1 && (
            <div className="-mt-2 mb-6">
              <Pagination {...pg} shown={pg.items.length} basePath="/dashboard/inbox" params={{ view: view === "mine" ? "mine" : undefined }} noun="chats" />
            </div>
          )}
        </div>
        {view === "all" && (
          <Section title="Live on your website now" count={liveRows.length} rows={liveRows.slice(0, PER_PAGE)} empty="No website chats in the last 30 minutes." live />
        )}
      </div>
    </div>
  );
}

function Section({ title, count, rows, empty, live = false }: { title: string; count: number; rows: Row[]; empty: string; live?: boolean }) {
  return (
    <section className="card mb-5 p-4 md:p-5">
      <h2 className="m-0 mb-3 flex items-center gap-2 text-[17px] font-semibold tracking-[-0.01em] text-ink">
        {live && <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#4ade80] shadow-[0_0_8px_2px_rgba(74,222,128,0.55)]" />}
        {title}
        <span className="tabular rounded-full bg-gray-100 px-2 py-0.5 text-[12px] font-bold text-gray-600">{count}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="m-0 rounded-2xl bg-[#f3f6fb] px-4 py-4 text-[13.5px] text-gray-600">{empty}</p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-2 p-0">
          {rows.map((r) => (
            <li key={r.id}>
              <a
                href={`/dashboard/conversations/${r.id}`}
                className="group flex gap-3 rounded-2xl border border-[rgba(15,31,56,0.06)] bg-[#f3f6fb] px-3.5 py-3 no-underline transition-colors hover:border-gold/40 hover:bg-white"
              >
                <ChannelTile channel={r.channel} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[14.5px] font-semibold text-ink">{r.contactName}</span>
                    <Badge tone={r.state.tone}>{r.state.label}</Badge>
                    <span className="ml-auto whitespace-nowrap text-[12px] text-gray-500">
                      {humanize(r.channel)} · {timeAgo(r.lastAt)}
                    </span>
                  </span>
                  {r.detail && <span className="mt-1.5 block rounded-xl border border-gold/35 bg-white px-3 py-2 text-[13px] leading-snug text-gray-800">{r.detail}</span>}
                  {r.lastMessage && <span className="mt-1.5 block truncate text-[13px] text-gray-600">{r.lastMessage}</span>}
                  <span className="mt-2 flex flex-wrap items-center gap-2">
                    {r.contactPhone && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 text-[12.5px] text-gray-700 ring-1 ring-gray-200">
                        <Phone size={12} aria-hidden="true" /> {r.contactPhone}
                      </span>
                    )}
                    <span className={`${btn.primary} ${btn.small} ml-auto`}>
                      Open <ArrowRight size={14} aria-hidden="true" />
                    </span>
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
