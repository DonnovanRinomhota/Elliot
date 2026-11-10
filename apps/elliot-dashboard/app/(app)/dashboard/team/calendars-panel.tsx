"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Panel, btn, timeAgo } from "../../../_ui/ui";
import { calendarState, isCalendarId, type CalendarStatus } from "@/lib/calendars";

export type CalendarMember = {
  id: string;
  email: string;
  full_name: string | null;
  role: "admin" | "agent" | "viewer";
  receives_leads: boolean;
  google_calendar_id: string | null;
  calendar_status: CalendarStatus;
  calendar_error: string | null;
  calendar_checked_at: string | null;
};

const DOT: Record<string, string> = { ok: "bg-accent", warn: "bg-brass", alert: "bg-alert", none: "bg-gray-300" };

// 0042: each agent's own Google Calendar. Elliot offers a time when at least
// one agent is free and books the viewing into that agent's calendar.
export default function CalendarsPanel({
  members,
  meId,
  canManage,
  elliotAccount,
  agencyCalendar,
}: {
  members: CalendarMember[];
  meId: string | null;
  canManage: boolean;
  elliotAccount: string | null;
  agencyCalendar: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(members.map((m) => [m.id, m.google_calendar_id ?? ""])));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const people = members.filter((m) => m.role !== "viewer");
  const inUse = people.filter((m) => m.receives_leads && m.google_calendar_id && m.calendar_status !== "not_shared" && m.calendar_status !== "read_only");

  async function check() {
    setBusy("check");
    setError(null);
    setNote(null);
    const res = await fetch("/api/team/calendar-check", { method: "POST" });
    const data = await res.json().catch(() => null);
    setBusy(null);
    if (!res.ok || !data?.success) return setError(data?.error || "Couldn't check the calendars.");
    setNote("Checked.");
    router.refresh();
  }

  async function save(m: CalendarMember) {
    const value = (drafts[m.id] ?? "").trim().toLowerCase();
    if (value && !isCalendarId(value)) return setError("A calendar ID looks like an email address: name@gmail.com, or …@group.calendar.google.com.");
    setBusy(m.id);
    setError(null);
    setNote(null);
    const { error: e } = await supabase.rpc("update_team_member", { p_member_id: m.id, p_changes: { google_calendar_id: value } });
    if (e) {
      setBusy(null);
      return setError(e.message);
    }
    // Check straight away so the status is real.
    if (value) await fetch("/api/team/calendar-check", { method: "POST" }).catch(() => null);
    setBusy(null);
    router.refresh();
  }

  return (
    <Panel
      title="Calendars"
      action={
        <button type="button" onClick={check} disabled={busy !== null} className={`${btn.secondary} ${btn.small}`}>
          {busy === "check" ? "Checking…" : "Check calendars"}
        </button>
      }
    >
      <div className="grid gap-4 text-[13px]">
        <p className="m-0 text-gray-600">
          {inUse.length
            ? `Elliot books viewings into agents' own calendars: it offers a time when an agent with a calendar here is free (${inUse.length} now), and picks the client's own agent first. Two agents can have viewings at the same time.`
            : `Elliot uses the agency calendar${agencyCalendar && agencyCalendar !== "primary" ? ` (${agencyCalendar})` : ""} from Settings, one viewing at a time. Add agents' own calendars below so they can have viewings at the same time.`}
        </p>

        <details className="rounded-lg bg-gray-50 px-3 py-2.5">
          <summary className="cursor-pointer font-medium text-ink">How to share a Google Calendar with Elliot</summary>
          <ol className="m-0 mt-2 list-decimal pl-5 text-gray-700">
            <li>Open Google Calendar on a computer. Next to the calendar under &ldquo;My calendars&rdquo;, click ⋮ → Settings and sharing.</li>
            <li>
              Under &ldquo;Share with specific people&rdquo;, click Add people and enter{" "}
              <strong className="font-semibold text-ink">{elliotAccount || "Elliot's Google account (click Check calendars to see it)"}</strong>.
            </li>
            <li>Choose <strong className="font-semibold text-ink">Make changes to events</strong>, then Send.</li>
            <li>Copy the Calendar ID from &ldquo;Integrate calendar&rdquo; on the same page (for your main calendar it&apos;s your email), paste it below and Save.</li>
          </ol>
          <p className="m-0 mt-2 text-[12.5px] text-gray-500">
            On a company Google Workspace, an administrator may need to allow sharing calendars outside the company.
          </p>
        </details>

        <ul className="m-0 grid list-none gap-0 p-0">
          {people.map((m) => {
            const editable = canManage || m.id === meId;
            const st = calendarState(m.google_calendar_id, m.calendar_status, m.calendar_error, elliotAccount);
            const changed = (drafts[m.id] ?? "").trim().toLowerCase() !== (m.google_calendar_id ?? "");
            return (
              <li key={m.id} className="grid gap-2 border-t border-gray-100 py-3 first:border-t-0 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto] sm:items-start">
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{m.full_name || m.email}</div>
                  {!m.receives_leads && <div className="text-[12px] text-gray-500">Doesn&apos;t get new leads</div>}
                </div>
                <div className="min-w-0">
                  <input
                    aria-label={`Google Calendar ID for ${m.full_name || m.email}`}
                    className="h-9 w-full px-3"
                    value={drafts[m.id] ?? ""}
                    onChange={(e) => setDrafts({ ...drafts, [m.id]: e.target.value })}
                    placeholder={m.email}
                    disabled={!editable || busy !== null}
                  />
                  <p className="m-0 mt-1 flex items-start gap-1.5 text-[12.5px] text-gray-600">
                    <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${DOT[st.tone]}`} aria-hidden />
                    <span>
                      {st.label}
                      {m.calendar_checked_at && st.tone !== "none" ? <span className="text-gray-400"> · checked {timeAgo(m.calendar_checked_at)}</span> : null}
                      {st.help && st.tone !== "ok" ? <span className="block text-gray-500">{st.help}</span> : null}
                    </span>
                  </p>
                </div>
                <div>
                  {editable && (
                    <button type="button" onClick={() => save(m)} disabled={busy !== null || !changed} className={`${btn.primary} ${btn.small}`}>
                      {busy === m.id ? "Saving…" : "Save"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {error && <p className="m-0 text-[12.5px] text-alert">{error}</p>}
        {note && <p className="m-0 text-[12.5px] text-gray-500">{note}</p>}
      </div>
    </Panel>
  );
}
