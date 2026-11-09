import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getCurrentTenantId, getMembership } from "@/lib/tenant";
import { contactLabel, withoutRepeats } from "@/lib/contacts";
import ReplyForm from "./reply-form";
import ChatControls from "./chat-controls";
import AutoRefresh from "../../auto-refresh";
import ContactPanel from "./contact-panel";
import { PageHeader, Panel, StatusBadge, formatDate, humanize } from "../../../../_ui/ui";
import BackButton from "@/app/_ui/back-button";

export default async function ConversationDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const [me, tenantId] = await Promise.all([getMembership(supabase, user.id), getCurrentTenantId(supabase)]);

  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .select("id, channel, status, created_at, assigned_human, handler:tenant_users!conversations_assigned_human_fkey(full_name, email), contact:contacts(id, name, email, phone)")
    .eq("id", params.id)
    .single();

  const { data: messages, error: msgError } = await supabase
    .from("messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", params.id)
    .order("created_at", { ascending: true });

  if (convError || !conversation) {
    return <p className="text-[13px] text-alert">Couldn&apos;t load this conversation: {convError?.message}</p>;
  }

  // Supabase returns `contact` as a single object at runtime (conversations.contact_id
  // is a many-to-one FK to contacts), but without generated Database types, postgrest-js
  // can't infer the cardinality from the select string and types it as an array. Assert
  // the real runtime shape here rather than indexing into it as an array.
  const contact = conversation.contact as unknown as {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;

  // "Reply as human" only makes sense where a reply can actually be delivered
  // somewhere real. chat_widget conversations are still one-shot request/
  // response (the widget itself is built -- apps/web-chat-widget -- but the
  // chat webhook has no persistent connection for a human reply to interrupt),
  // so a dashboard reply there would silently go nowhere. Email is async and
  // has a real send pipeline (workflow 17 -> 15), so that's the only channel
  // this supports today. See KNOWN_ISSUES.md.
  const canReplyAsHuman = conversation.channel === "email" && !!contact?.email;
  // Website chat and WhatsApp: a person can take over live (0027 + the
  // widget's polling; WhatsApp replies go out through workflow 32).
  const isLiveChat = conversation.channel === "chat_widget" || conversation.channel === "whatsapp";
  // Email (0035): Elliot answers emails itself, so the team can pause it here too.
  const isAutoEmail = conversation.channel === "email";
  const handler = conversation.handler as unknown as { full_name: string | null; email: string } | null;
  const handledByMe = Boolean(me && conversation.assigned_human === me.id);
  const handlerName = conversation.assigned_human && !handledByMe ? handler?.full_name || handler?.email?.split("@")[0] || "A colleague" : null;

  const contactName = contactLabel(contact, conversation.channel);
  // Older chats can hold the same visitor message several times (fixed in
  // workflow 01; migration 0031 removes the copies). Never show them twice.
  const shown = withoutRepeats((messages ?? []) as { id: string; role: string; content: string; created_at: string }[]);
  // WhatsApp's 24-hour reply window starts at the client's last message.
  const lastInboundAt = [...shown].reverse().find((m) => m.role === "user")?.created_at ?? null;
  const ROLE_LABEL: Record<string, string> = {
    user: contactName,
    assistant: "Elliot",
    human_agent: "Team",
    system: "System",
  };
  const messageTime = (iso: string) =>
    new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div>
      <BackButton fallback="/dashboard/conversations" />
      <PageHeader
        title={contactName}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge kind="conversation" value={conversation.status} />
            <span>{humanize(conversation.channel)}</span>
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
          <Panel title="Messages">
            {msgError && <p className="m-0 mb-3 text-[13px] text-alert">Couldn&apos;t load messages: {msgError.message}</p>}
            <ol className="m-0 grid list-none gap-4 p-0">
              {shown.map((m) => {
                if (m.role === "system") {
                  return (
                    <li key={m.id} className="text-center text-[12px] text-gray-500">
                      {m.content} · {messageTime(m.created_at)}
                    </li>
                  );
                }
                const isOutbound = m.role === "assistant" || m.role === "human_agent";
                const isHuman = m.role === "human_agent";
                return (
                  <li key={m.id} className={`flex flex-col ${isOutbound ? "items-end" : "items-start"}`}>
                    <div className="mb-1 text-[12px] text-gray-500">
                      <span className="font-medium text-gray-700">{ROLE_LABEL[m.role] || m.role}</span>{" "}
                      {messageTime(m.created_at)}
                    </div>
                    <div
                      className={`max-w-[78%] whitespace-pre-wrap [overflow-wrap:anywhere] rounded-lg px-4 py-2.5 text-[14px] leading-relaxed ${
                        isHuman
                          ? "bg-ink text-white"
                          : isOutbound
                            ? "bg-ink-soft text-ink"
                            : "border border-gray-200 bg-white text-gray-800"
                      }`}
                    >
                      {m.content}
                    </div>
                  </li>
                );
              })}
            </ol>
            {shown.length === 0 && !msgError && (
              <p className="m-0 text-[13px] text-gray-500">No messages in this conversation.</p>
            )}
          </Panel>

          {isAutoEmail && (
            <div className="mt-6">
              <ChatControls
                conversationId={conversation.id}
                handledByMe={handledByMe}
                handlerName={handlerName}
                canTakeOver={Boolean(me)}
                channel="email"
              />
            </div>
          )}
          {canReplyAsHuman && (
            <ReplyForm conversationId={conversation.id} contactId={contact!.id} toEmail={contact!.email!} defaultSubject="" />
          )}
          {isLiveChat && (
            <>
              {conversation.assigned_human && <AutoRefresh seconds={4} />}
              {/* Pinned to the bottom of the screen while the messages scroll. */}
              <div className="sticky bottom-0 z-10 -mx-2 mt-6 bg-gradient-to-t from-[#eef1f6] from-70% to-transparent px-2 pb-4 pt-3">
                <ChatControls
                  conversationId={conversation.id}
                  handledByMe={handledByMe}
                  handlerName={handlerName}
                  canTakeOver={Boolean(me)}
                  channel={conversation.channel === "whatsapp" ? "whatsapp" : "chat_widget"}
                  lastInboundAt={lastInboundAt}
                />
              </div>
            </>
          )}
          {!canReplyAsHuman && !isLiveChat && conversation.channel !== "email" && (
            <p className="mb-0 mt-3 text-[13px] text-gray-500">
              You can&apos;t reply to {humanize(conversation.channel).toLowerCase()} conversations from here yet. There&apos;s
              no live connection to deliver the reply through.
            </p>
          )}
        </div>

        {/* Stays in view while the messages scroll (desktop; it sits under them on a phone). */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <ContactPanel
            tenantId={tenantId}
            conversationId={conversation.id}
            channel={conversation.channel}
            contact={contact}
            facts={[
              ["Channel", humanize(conversation.channel)],
              ["Started", formatDate(conversation.created_at, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })],
            ]}
          />
        </aside>
      </div>
    </div>
  );
}
