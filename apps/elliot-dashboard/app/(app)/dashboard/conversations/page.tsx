import { ArrowRight, Search, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { contactLabel } from "@/lib/contacts";
import { DEFAULT_TZ, dayKey, personName, timeOf } from "@/lib/appointments";
import { conversationActivity, lookingFor } from "@/lib/conversation-summary";
import FolderTabs, { FolderTab } from "../folder-tabs";
import { ErasedNotice } from "./[id]/client-data";
import { ChannelTile } from "../../../_ui/brands";
import { ElliotMark } from "../../../_ui/elliot-logo";
import { EmptyState, PageHeader, Pagination, StagePill, btn, humanize, paginate, timeAgo } from "../../../_ui/ui";

type Conv = {
  id: string;
  channel: string;
  status: string;
  created_at: string;
  assigned_human: string | null;
  contact_id: string | null;
  contact: { name: string | null; email: string | null; phone: string | null } | null;
};

const CHANNELS = [
  { key: "chat_widget", label: "Website" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "email", label: "Email" },
  { key: "sms", label: "SMS" },
];

const STATUS_PILL: Record<string, [string, string]> = {
  open: ["Open", "bg-accent-soft text-accent-dark"],
  escalated: ["Needs a person", "bg-alert-soft text-alert-dark"],
  closed: ["Closed", "bg-gray-100 text-gray-600"],
};

const TONE_TEXT = { ok: "text-[#237a49]", wait: "text-brass-dark", alert: "text-alert", muted: "text-gray-500" } as const;

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: { status?: string; days?: string; date?: string; page?: string; channel?: string; clients?: string; q?: string; c?: string };
}) {
  const supabase = createClient();

  const [{ data: conversations, error }, { data: spamRows }, { data: tenantRow }] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, channel, status, created_at, assigned_human, contact_id, contact:contacts(name, email, phone)")
      .order("created_at", { ascending: false }),
    // Emails Elliot classed as spam (automatic notifications and the like): their conversations aren't clients.
    supabase.from("email_drafts").select("conversation_id").eq("category", "spam"),
    supabase.from("tenants").select("timezone").maybeSingle(),
  ]);

  if (error) {
    return <p className="text-[13px] text-alert">Couldn&apos;t load conversations: {error.message}</p>;
  }
  const tz = tenantRow?.timezone || DEFAULT_TZ;
  const notClient = new Set((spamRows ?? []).map((r: { conversation_id: string | null }) => r.conversation_id).filter(Boolean) as string[]);

  let scoped = (conversations ?? []) as unknown as Conv[];

  const days = searchParams.days ? Number(searchParams.days) : null;
  if (days) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    scoped = scoped.filter((c) => new Date(c.created_at).getTime() >= cutoff);
  }
  if (searchParams.date) {
    scoped = scoped.filter((c) => c.created_at.slice(0, 10) === searchParams.date);
  }
  const clientsOnly = searchParams.clients === "1";
  if (clientsOnly) scoped = scoped.filter((c) => !notClient.has(c.id));

  // Search: the client's name, email or phone, or words in the messages.
  const q = (searchParams.q || "").trim();
  if (q) {
    const needle = q.toLowerCase();
    const { data: hits } = await supabase.from("messages").select("conversation_id").ilike("content", `%${q.replace(/[%_]/g, "")}%`).limit(500);
    const inMessages = new Set((hits ?? []).map((h: { conversation_id: string }) => h.conversation_id));
    scoped = scoped.filter(
      (c) => inMessages.has(c.id) || [c.contact?.name, c.contact?.email, c.contact?.phone].some((v) => v && v.toLowerCase().includes(needle))
    );
  }

  // Channels the agency actually has, with counts.
  const channelCounts = CHANNELS.map((ch) => ({ ...ch, count: scoped.filter((c) => c.channel === ch.key).length })).filter((ch) => ch.count > 0);
  const channel = CHANNELS.some((ch) => ch.key === searchParams.channel) ? (searchParams.channel as string) : null;
  if (channel) scoped = scoped.filter((c) => c.channel === channel);

  // Status tabs reflect the statuses this agency's conversations actually have.
  const STATUS_ORDER = ["open", "escalated", "closed"];
  const distinctStatuses = Array.from(new Set(((conversations ?? []) as unknown as Conv[]).map((c) => c.status))).sort(
    (a, b) => (STATUS_ORDER.indexOf(a) + 1 || 99) - (STATUS_ORDER.indexOf(b) + 1 || 99)
  );
  const tabs: FolderTab[] = [
    { key: "all", label: "All", count: scoped.length },
    ...distinctStatuses.map((s) => ({ key: s, label: STATUS_PILL[s]?.[0] ?? humanize(s), count: scoped.filter((c) => c.status === s).length })),
  ];
  const activeStatus = tabs.some((t) => t.key === searchParams.status) ? (searchParams.status as string) : "all";
  const visible = activeStatus === "all" ? scoped : scoped.filter((c) => c.status === activeStatus);

  const pg = paginate(visible, searchParams.page);
  const items = pg.items;
  const ids = items.map((c) => c.id);
  const contactIds = items.map((c) => c.contact_id).filter(Boolean) as string[];

  // What's needed for this page's rows only.
  const [{ data: msgRows }, { data: leadRows }, { data: bookingRows }, { data: emailDrafts }, { data: waDrafts }, { data: people }] = await Promise.all([
    ids.length
      ? supabase.from("messages").select("conversation_id, role, content, created_at").in("conversation_id", ids).neq("role", "system").order("created_at", { ascending: false }).limit(600)
      : Promise.resolve({ data: [] as any[] }),
    contactIds.length ? supabase.from("leads").select("contact_id, status").in("contact_id", contactIds) : Promise.resolve({ data: [] as any[] }),
    ids.length
      ? supabase.from("appointments").select("conversation_id, starts_at").in("conversation_id", ids).in("status", ["confirmed", "rescheduled"]).order("starts_at")
      : Promise.resolve({ data: [] as any[] }),
    ids.length ? supabase.from("email_drafts").select("conversation_id").in("conversation_id", ids).eq("status", "pending") : Promise.resolve({ data: [] as any[] }),
    ids.length ? supabase.from("whatsapp_drafts").select("conversation_id").in("conversation_id", ids).eq("status", "pending") : Promise.resolve({ data: [] as any[] }),
    supabase.from("tenant_users").select("id, full_name, email"),
  ]);

  const lastMessage = new Map<string, { role: string; content: string; created_at: string }>();
  for (const m of (msgRows ?? []) as { conversation_id: string; role: string; content: string; created_at: string }[]) {
    if (!lastMessage.has(m.conversation_id)) lastMessage.set(m.conversation_id, m);
  }
  const lastFromClient = new Map<string, string>();
  for (const m of (msgRows ?? []) as { conversation_id: string; role: string; content: string }[]) {
    if (m.role === "user" && !lastFromClient.has(m.conversation_id)) lastFromClient.set(m.conversation_id, m.content);
  }
  const stageOf = new Map(((leadRows ?? []) as { contact_id: string; status: string }[]).map((l) => [l.contact_id, l.status]));
  const bookingOf = new Map<string, { starts_at: string }>();
  for (const b of (bookingRows ?? []) as { conversation_id: string; starts_at: string }[]) {
    if (!bookingOf.has(b.conversation_id) && new Date(b.starts_at) > new Date()) bookingOf.set(b.conversation_id, b);
  }
  const waiting = new Set([...(emailDrafts ?? []), ...(waDrafts ?? [])].map((d: { conversation_id: string }) => d.conversation_id));
  const nameOf = new Map(((people ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => [p.id, personName(p)]));

  // ── The conversation open on the right (desktop) ──
  const selected = items.find((c) => c.id === searchParams.c) ?? items[0] ?? null;
  let thread: { role: string; content: string; created_at: string }[] = [];
  let selectedLead = null as { status: string; score: number | null; qualification_answers: Record<string, unknown> | null } | null;
  if (selected) {
    const [{ data: t }, { data: l }] = await Promise.all([
      supabase.from("messages").select("role, content, created_at").eq("conversation_id", selected.id).neq("role", "system").order("created_at", { ascending: false }).limit(12),
      selected.contact_id
        ? supabase.from("leads").select("status, score, qualification_answers").eq("contact_id", selected.contact_id).order("updated_at", { ascending: false }).limit(1).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    thread = ((t ?? []) as typeof thread).reverse();
    selectedLead = l as typeof selectedLead;
  }

  // Links keep the current filters.
  const baseParams: Record<string, string> = {};
  if (days) baseParams.days = String(days);
  if (searchParams.date) baseParams.date = searchParams.date;
  if (clientsOnly) baseParams.clients = "1";
  if (q) baseParams.q = q;
  const href = (over: Record<string, string | null>) => {
    const p = new URLSearchParams({ ...baseParams, ...(channel ? { channel } : {}), ...(activeStatus !== "all" ? { status: activeStatus } : {}) });
    Object.entries(over).forEach(([k, v]) => (v == null ? p.delete(k) : p.set(k, v)));
    const s = p.toString();
    return `/dashboard/conversations${s ? `?${s}` : ""}`;
  };
  const tabParams = { ...baseParams, ...(channel ? { channel } : {}) };

  const filterLabel = searchParams.date
    ? new Date(`${searchParams.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
    : days
      ? `the last ${days} days`
      : null;

  const chip = (on: boolean) =>
    `inline-flex h-9 items-center gap-2 rounded-full border px-3 text-[13.5px] no-underline transition-colors ${
      on ? "border-white bg-white font-medium text-ink" : "border-white/25 bg-[#071a3a]/45 text-white backdrop-blur-sm hover:bg-[#071a3a]/65"
    }`;

  const sel = selected;
  const selActivity = sel
    ? conversationActivity({
        status: sel.status,
        notClient: notClient.has(sel.id),
        handler: sel.assigned_human ? nameOf.get(sel.assigned_human) : null,
        booking: bookingOf.get(sel.id) ?? null,
        draftWaiting: waiting.has(sel.id),
        lastRole: lastMessage.get(sel.id)?.role,
        tz,
      })
    : null;

  return (
    <div>
      <PageHeader
        title="Conversations"
        description={
          filterLabel ? (
            <>
              {scoped.length} conversation{scoped.length === 1 ? "" : "s"} from {filterLabel}.{" "}
              <a href="/dashboard/conversations" className="underline">
                Show all
              </a>
            </>
          ) : (
            "Every chat, WhatsApp and email thread Elliot has had with your clients."
          )
        }
        actions={
          <a href={href({ clients: clientsOnly ? null : "1", page: null, c: null })} className={chip(clientsOnly)}>
            {clientsOnly ? "Showing clients only" : "Hide non-clients"}
          </a>
        }
        tabs={
          <div className="grid gap-2.5">
            <FolderTabs tabs={tabs} activeKey={activeStatus} basePath="/dashboard/conversations" extraParams={tabParams} />
            {channelCounts.length > 1 && (
              <nav aria-label="Filter by channel" className="-mx-1 overflow-x-auto px-1 pb-1">
                <div className="flex min-w-max gap-2">
                  <a href={href({ channel: null, page: null, c: null })} className={chip(!channel)}>
                    Every channel
                  </a>
                  {channelCounts.map((ch) => (
                    <a key={ch.key} href={href({ channel: ch.key, page: null, c: null })} className={chip(channel === ch.key)} aria-current={channel === ch.key ? "page" : undefined}>
                      <ChannelTile channel={ch.key} size={22} />
                      {ch.label} <b className="tabular">{ch.count}</b>
                    </a>
                  ))}
                </div>
              </nav>
            )}
          </div>
        }
      />
      <ErasedNotice />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        {/* ── The list ── */}
        <section className="card p-4 md:p-5" aria-label="Conversations">
          <form method="get" action="/dashboard/conversations" className="mb-3 flex items-center gap-2">
            {Object.entries({ ...tabParams, ...(activeStatus !== "all" ? { status: activeStatus } : {}) })
              .filter(([k]) => k !== "q")
              .map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
            <label className="relative flex-1">
              <span className="sr-only">Search conversations</span>
              <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input name="q" defaultValue={q} placeholder="Search name, email, phone or message…" className="h-10 w-full !rounded-full pl-10 pr-4" />
            </label>
            {q && (
              <a href={href({ q: null, page: null, c: null })} className={btn.ghost}>
                Clear
              </a>
            )}
          </form>

          {visible.length === 0 ? (
            <EmptyState title={q ? "Nothing matches that search" : "No conversations here"}>
              {q ? "Try a name, an email address or a word from the chat." : "Conversations appear as soon as someone writes to Elliot."}
            </EmptyState>
          ) : (
            <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-2 p-0">
              {items.map((c) => {
                const last = lastMessage.get(c.id);
                const preview = lastFromClient.get(c.id) || last?.content || "";
                const stage = c.contact_id ? stageOf.get(c.contact_id) : undefined;
                const isNotClient = notClient.has(c.id);
                const act = conversationActivity({
                  status: c.status,
                  notClient: isNotClient,
                  handler: c.assigned_human ? nameOf.get(c.assigned_human) : null,
                  booking: bookingOf.get(c.id) ?? null,
                  draftWaiting: waiting.has(c.id),
                  lastRole: last?.role,
                  tz,
                });
                const [statusLabel, statusClass] = isNotClient ? ["Not a client", "bg-gray-100 text-gray-500"] : STATUS_PILL[c.status] ?? [humanize(c.status), "bg-gray-100 text-gray-600"];
                const isSel = sel?.id === c.id;
                const body = (
                  <>
                    <ChannelTile channel={c.channel} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={`truncate text-[14px] font-semibold ${isNotClient ? "text-gray-500" : "text-ink"}`}>{contactLabel(c.contact, c.channel)}</span>
                        {stage && <StagePill stage={stage} />}
                      </span>
                      {preview && <span className="mt-0.5 block truncate text-[13px] text-gray-700">{preview.replace(/\s+/g, " ")}</span>}
                      <span className={`mt-1 flex items-center gap-1.5 truncate text-[12.5px] ${TONE_TEXT[act.tone]}`}>
                        <Sparkles size={12} aria-hidden="true" className="flex-shrink-0" />
                        <span className="truncate">{act.text}</span>
                      </span>
                    </span>
                    <span className="flex flex-shrink-0 flex-col items-end gap-2">
                      <span className="whitespace-nowrap text-[12px] text-gray-500">{timeAgo(last?.created_at || c.created_at)}</span>
                      <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${statusClass}`}>{statusLabel}</span>
                    </span>
                  </>
                );
                const rowClass = `flex items-center gap-3 rounded-2xl border px-3 py-3 no-underline transition-colors ${
                  isSel ? "lg:border-gold/60 lg:bg-white lg:shadow-card" : ""
                } border-[rgba(15,31,56,0.06)] bg-[#f3f6fb] hover:border-gold/40 hover:bg-white`;
                return (
                  <li key={c.id}>
                    {/* Phones open the conversation; wider screens show it on the right. */}
                    <a href={`/dashboard/conversations/${c.id}`} className={`${rowClass} lg:hidden`}>
                      {body}
                    </a>
                    <a href={href({ c: c.id })} aria-current={isSel ? "true" : undefined} className={`${rowClass} hidden lg:flex`}>
                      {body}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
          <Pagination
            {...pg}
            shown={items.length}
            basePath="/dashboard/conversations"
            params={{ ...tabParams, status: activeStatus === "all" ? undefined : activeStatus }}
            noun="conversations"
          />
        </section>

        {/* ── The open conversation (desktop) ── */}
        {sel && (
          <section className="card sticky top-[170px] hidden max-h-[calc(100vh-190px)] flex-col self-start p-5 lg:flex" aria-label="Selected conversation">
            <div className="flex items-center gap-3 border-b border-gray-200 pb-4">
              <ChannelTile channel={sel.channel} size={40} />
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-[18px] font-semibold text-ink">{contactLabel(sel.contact, sel.channel)}</p>
                <p className="m-0 truncate text-[12.5px] text-gray-500">
                  {[sel.contact?.email, sel.contact?.phone, humanize(sel.channel)].filter(Boolean).join(" · ")}
                </p>
              </div>
              {selectedLead && (
                <span className="flex items-center gap-1.5">
                  <StagePill stage={selectedLead.status} />
                  {selectedLead.score != null && <span className="tabular text-[12.5px] font-semibold text-gray-600">{Math.round(Number(selectedLead.score))}</span>}
                </span>
              )}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                ["Looking for", selectedLead ? lookingFor(selectedLead.qualification_answers) : null],
                ["Status", notClient.has(sel.id) ? "Not a client" : STATUS_PILL[sel.status]?.[0] ?? humanize(sel.status)],
                ["Started", `${dayKey(sel.created_at, tz) === dayKey(new Date(), tz) ? "Today" : new Date(sel.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: tz })} ${timeOf(sel.created_at, tz)}`],
              ].map(([label, value]) => (
                <div key={label as string} className="min-w-0 rounded-2xl border border-[rgba(15,31,56,0.06)] bg-[#f3f6fb] px-3 py-2.5">
                  <p className="m-0 text-[11.5px] text-gray-500">{label}</p>
                  <p className="m-0 mt-0.5 truncate text-[13.5px] font-semibold text-ink" title={(value as string) || undefined}>
                    {value || "Not known yet"}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
              {thread.length === 0 ? (
                <p className="m-0 text-[13.5px] text-gray-500">No messages yet.</p>
              ) : (
                <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
                  {thread.map((m, i) => {
                    const mine = m.role !== "user";
                    return (
                      <li
                        key={i}
                        className={`max-w-[82%] whitespace-pre-line break-words px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
                          mine
                            ? "self-end rounded-[16px_16px_6px_16px] bg-[linear-gradient(135deg,#071631,#14325c)] text-white"
                            : "self-start rounded-[16px_16px_16px_6px] border border-[rgba(15,31,56,0.07)] bg-[#f3f6fb] text-ink"
                        }`}
                      >
                        <span className="line-clamp-[8]">{m.content}</span>
                        <span className={`mt-1 block text-[11.5px] ${mine ? "text-white/60" : "text-gray-500"}`}>
                          {m.role === "user" ? "Client" : m.role === "human_agent" ? "Your team" : "Elliot"} · {timeOf(m.created_at, tz)}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>

            <div className="mt-4 flex items-center gap-3 rounded-2xl border border-[rgba(15,31,56,0.06)] bg-[#f3f6fb] p-3">
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#0b1426] ring-1 ring-gold/60">
                <ElliotMark size={15} />
              </span>
              <p className={`m-0 min-w-0 flex-1 text-[13px] ${selActivity ? TONE_TEXT[selActivity.tone] : "text-gray-600"}`}>{selActivity?.text}</p>
              <a href={`/dashboard/conversations/${sel.id}`} className={`${btn.primary} !h-10`}>
                Open conversation <ArrowRight size={15} aria-hidden="true" />
              </a>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
