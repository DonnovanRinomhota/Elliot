"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Badge, ErrorText, Panel, btn, humanize, timeAgo } from "../../../_ui/ui";

export type Member = {
  id: string;
  email: string;
  full_name: string | null;
  role: "admin" | "agent" | "viewer";
  receives_leads: boolean;
  notify_escalations: boolean;
  notify_digest: boolean | null;
  last_assigned_at: string | null;
  open_leads: number;
};

const ROLE_HELP: Record<Member["role"], string> = {
  admin: "Everything, including team and settings",
  agent: "Leads, chats, viewings and approvals",
  viewer: "Can look, never gets leads",
};

function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <label className={`inline-flex items-center gap-2 text-[13px] ${disabled ? "text-gray-400" : "cursor-pointer text-gray-700"}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span className="sm:hidden">{label}</span>
    </label>
  );
}

export default function TeamManager({
  tenantId,
  members,
  meId,
  canManage,
  unassignedLeads,
  digestEnabled,
  agencyAlertEmail,
}: {
  tenantId: string;
  members: Member[];
  meId: string | null;
  canManage: boolean;
  unassignedLeads: number;
  digestEnabled: boolean;
  agencyAlertEmail: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [invite, setInvite] = useState({ email: "", full_name: "", role: "agent" });
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  async function change(member: Member, changes: Record<string, unknown>) {
    setError(null);
    setBusyId(member.id);
    const { error: e } = await supabase.rpc("update_team_member", { p_member_id: member.id, p_changes: changes });
    setBusyId(null);
    if (e) return setError(e.message);
    router.refresh();
  }

  async function remove(member: Member) {
    if (!window.confirm(`Remove ${member.full_name || member.email}? Their login is deleted and their open leads become unassigned. Past activity stays on record.`)) return;
    setError(null);
    setBusyId(member.id);
    const res = await fetch(`/api/team/${member.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => null);
    setBusyId(null);
    if (!res.ok || !data?.success) return setError(data?.error || "Couldn't remove them.");
    router.refresh();
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteMsg(null);
    setError(null);
    setInviting(true);
    const res = await fetch("/api/team/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(invite),
    });
    const data = await res.json().catch(() => null);
    setInviting(false);
    if (!res.ok || !data?.success) return setError(data?.error || "Couldn't send the invitation.");
    setInviteMsg(`Invitation sent to ${invite.email}. They'll get an email with a link to set their password.`);
    setInvite({ email: "", full_name: "", role: "agent" });
    router.refresh();
  }

  async function setDigest(enabled: boolean) {
    setError(null);
    const { data: changed, error: e } = await supabase
      .from("ai_config")
      .update({ daily_digest_enabled: enabled })
      .eq("tenant_id", tenantId)
      .select("tenant_id");
    if (e) return setError(e.message);
    // 0047: the database lets only an agency admin change settings.
    if (!changed?.length) return setError("Only an admin of your agency can change this.");
    router.refresh();
  }

  const nextUp = [...members]
    .filter((m) => m.receives_leads && m.role !== "viewer")
    .sort((a, b) => (a.last_assigned_at ? new Date(a.last_assigned_at).getTime() : 0) - (b.last_assigned_at ? new Date(b.last_assigned_at).getTime() : 0))[0];

  // minmax(0,1fr): a grid column otherwise grows to the members table's width on
  // phones, so the whole page scrolled sideways instead of just the table.
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      {error && <ErrorText>{error}</ErrorText>}

      <Panel
        title={`People (${members.length})`}
        action={
          nextUp ? (
            <span className="text-[12.5px] text-gray-500">
              Next new lead goes to <span className="text-ink">{nextUp.full_name || nextUp.email}</span>
            </span>
          ) : (
            <span className="text-[12.5px] text-alert">Nobody receives leads. Switch it on for someone.</span>
          )
        }
        flush
      >
        <div className="overflow-x-auto px-3">
          <table className="w-full min-w-[760px] border-separate border-spacing-y-2 text-left text-[13px]">
            <thead>
              <tr className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-gray-500">
                <th className="px-5 py-2.5 font-medium">Person</th>
                <th className="px-3 py-2.5 font-medium">Role</th>
                <th className="px-3 py-2.5 text-center font-medium" title="Included when new leads are shared out in turn">Gets new leads</th>
                <th className="px-3 py-2.5 text-center font-medium" title="Email when a chat needs a person: hot lead, asked for a human, upset customer">Alerts</th>
                <th className="px-3 py-2.5 text-center font-medium" title="Morning summary email at 08:00">Daily summary</th>
                <th className="px-3 py-2.5 text-right font-medium">Open leads</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const isMe = m.id === meId;
                const editable = canManage || isMe;
                const busy = busyId === m.id;
                const digest = m.notify_digest ?? m.role === "admin";
                return (
                  <tr key={m.id} className="[&>td:first-child]:rounded-l-2xl [&>td:last-child]:rounded-r-2xl [&>td]:bg-glass">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                      <span aria-hidden="true" className="gold-fill flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-navy">
                        {(m.full_name || m.email)
                          .split(/[\s.@_-]+/)
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((w: string) => w[0]!.toUpperCase())
                          .join("")}
                      </span>
                      <div className="min-w-0">
                      <div className="font-semibold text-ink">
                        {m.full_name || m.email}
                        {isMe && <span className="ml-1.5 text-[12px] font-normal text-gray-500">(you)</span>}
                      </div>
                      {m.full_name && <div className="text-[12px] text-gray-500">{m.email}</div>}
                      {editable && !m.full_name && (
                        <button
                          type="button"
                          className="mt-0.5 text-[12px] text-gray-500 underline hover:text-ink"
                          onClick={() => {
                            const name = window.prompt("Name shown to colleagues and clients", "");
                            if (name) change(m, { full_name: name });
                          }}
                        >
                          Add name
                        </button>
                      )}
                      </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {canManage ? (
                        <select
                          aria-label={`Role for ${m.email}`}
                          value={m.role}
                          disabled={busy}
                          onChange={(e) => change(m, { role: e.target.value })}
                          className="h-8 px-2 text-[13px]"
                          title={ROLE_HELP[m.role]}
                        >
                          <option value="admin">Admin</option>
                          <option value="agent">Agent</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      ) : (
                        <Badge tone={m.role === "admin" ? "ink" : "neutral"}>{humanize(m.role)}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <Toggle label="Gets new leads" checked={m.receives_leads && m.role !== "viewer"} disabled={!editable || busy || m.role === "viewer"} onChange={(v) => change(m, { receives_leads: v })} />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <Toggle label="Alerts" checked={m.notify_escalations} disabled={!editable || busy} onChange={(v) => change(m, { notify_escalations: v })} />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <Toggle label="Daily summary" checked={digest} disabled={!editable || busy || !digestEnabled} onChange={(v) => change(m, { notify_digest: v })} />
                    </td>
                    <td className="tabular px-3 py-3 text-right">
                      <a href={`/dashboard/leads?owner=${m.id}`} className="text-ink no-underline hover:underline">{m.open_leads}</a>
                      {m.last_assigned_at && <div className="text-[12px] text-gray-500">last {timeAgo(m.last_assigned_at)}</div>}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {canManage && !isMe && (
                        <button type="button" onClick={() => remove(m)} disabled={busy} className={`${btn.dangerGhost} ${btn.small}`}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-gray-100 px-5 py-3 text-[12.5px] text-gray-500">
          New leads are shared out in turn among people with &ldquo;Gets new leads&rdquo; on.
          {unassignedLeads > 0 && <> {unassignedLeads} open lead{unassignedLeads === 1 ? " has" : "s have"} no owner yet (they arrived before this was switched on).</>}
          {agencyAlertEmail && <> Alerts also go to {agencyAlertEmail} (set in Settings).</>}
        </div>
      </Panel>

      {canManage && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Invite someone">
            <form onSubmit={sendInvite} className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[12.5px] font-medium text-gray-600" htmlFor="inv-email">Email</label>
                  <input id="inv-email" type="email" required value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} className="h-9 w-full px-3" />
                </div>
                <div>
                  <label className="mb-1 block text-[12.5px] font-medium text-gray-600" htmlFor="inv-name">Name</label>
                  <input id="inv-name" value={invite.full_name} onChange={(e) => setInvite({ ...invite, full_name: e.target.value })} className="h-9 w-full px-3" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[12.5px] font-medium text-gray-600" htmlFor="inv-role">Role</label>
                <select id="inv-role" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })} className="h-9 w-full px-3">
                  <option value="agent">Agent: {ROLE_HELP.agent.toLowerCase()}</option>
                  <option value="admin">Admin: {ROLE_HELP.admin.toLowerCase()}</option>
                  <option value="viewer">Viewer: {ROLE_HELP.viewer.toLowerCase()}</option>
                </select>
              </div>
              {inviteMsg && <p className="m-0 text-[13px] text-ink">{inviteMsg}</p>}
              <div>
                <button type="submit" disabled={inviting} className={btn.primary}>
                  {inviting ? "Sending…" : "Send invitation"}
                </button>
              </div>
            </form>
          </Panel>

          <Panel title="Daily summary email">
            <div className="grid gap-3 text-[13px] text-gray-600">
              <p className="m-0">
                Every morning at 08:00, people with &ldquo;Daily summary&rdquo; on get one short email: yesterday&apos;s chats, new leads and
                viewings, today&apos;s viewings, hot leads waiting for a call, and anything that needs them.
              </p>
              <label className="inline-flex items-center gap-2 text-ink">
                <input type="checkbox" checked={digestEnabled} disabled={!canManage} onChange={(e) => setDigest(e.target.checked)} />
                Send daily summaries for this agency
              </label>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
