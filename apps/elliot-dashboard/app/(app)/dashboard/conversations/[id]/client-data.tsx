"use client";

import { useEffect, useState } from "react";
import { Panel, btn } from "../../../../_ui/ui";

type CalendarEvent = { calendar: string; event_id: string; starts_at: string };
type Erased = { summary: string; events: CalendarEvent[]; filesLeft: number };
const ERASED_KEY = "elliot_client_erased";

// A client asks what we hold about them, or asks us to delete it (GDPR).
// Agency admins only; the database checks again (0051). Erasing removes this
// client from every conversation, enquiry, viewing and draft, not only this
// chat. See docs/data-protection.md.
export default function ClientData({ contactId, name }: { contactId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Erased | null>(null);

  async function erase() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/contacts/${contactId}/erase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: typed }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok || !data?.success) return setError(data?.error || `Couldn't delete (${res.status}).`);
    const result: Erased = { summary: data.summary, events: data.calendar_events ?? [], filesLeft: data.files_not_removed ?? 0 };
    // This conversation no longer exists: show the result on the list instead
    // (the page refreshes itself and would otherwise lose it).
    try {
      sessionStorage.setItem(ERASED_KEY, JSON.stringify(result));
      window.location.assign("/dashboard/conversations");
      return;
    } catch {
      setDone(result);
    }
  }

  if (done) return <ErasedDetails result={done} />;

  return (
    <Panel title="Client's data">
      <div className="grid gap-3 text-[13px]">
        <p className="m-0 text-gray-600">If {name} asks what you hold about them, or asks you to delete it.</p>
        <a href={`/api/contacts/${contactId}/export`} className={`${btn.secondary} ${btn.small} w-fit`} download>
          Download a copy
        </a>
        {!open ? (
          <button type="button" onClick={() => setOpen(true)} className={`${btn.dangerGhost} ${btn.small} w-fit`}>
            Delete this client…
          </button>
        ) : (
          <div className="grid gap-2 rounded-md border border-alert/25 bg-alert-soft p-3">
            <p className="m-0 text-[12.5px] text-alert-dark">
              This permanently deletes {name}: every conversation, message, file, enquiry, viewing and draft, across all channels. It
              can&apos;t be undone. Upcoming viewings stay in Google Calendar; you&apos;ll see which ones to remove. Copies outside
              Elliot (your inbox, your CRM) aren&apos;t touched.
            </p>
            <label htmlFor="erase-confirm" className="text-[12.5px] font-medium text-alert-dark">
              Type <strong>delete</strong> to confirm
            </label>
            <input id="erase-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} className="h-9 w-full px-3" autoComplete="off" />
            {error && (
              <p className="m-0 text-[12.5px] text-alert" role="alert">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={erase}
                disabled={busy || typed.trim().toLowerCase() !== "delete"}
                className={`${btn.danger} ${btn.small}`}
              >
                {busy ? "Deleting…" : "Delete permanently"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setTyped("");
                  setError(null);
                }}
                className={`${btn.ghost} ${btn.small}`}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

// What was deleted and what is left to do by hand.
function ErasedDetails({ result, onClose }: { result: Erased; onClose?: () => void }) {
  return (
    <Panel title="Client deleted">
      <div className="grid gap-3 text-[13px]">
        <p className="m-0 text-ink">{result.summary}</p>
        <p className="m-0 text-gray-600">The activity log records that a deletion happened, with no personal details.</p>
        {result.events.length > 0 && (
          <div className="rounded-md bg-brass-soft px-3 py-2 text-[12.5px] text-brass-dark">
            <p className="m-0 font-medium">Still in Google Calendar. Delete these by hand:</p>
            <ul className="m-0 mt-1 list-disc pl-4">
              {result.events.map((e) => (
                <li key={e.event_id}>
                  {new Date(e.starts_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  {e.calendar ? ` (${e.calendar})` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        {result.filesLeft > 0 && (
          <p className="m-0 text-[12.5px] text-alert">
            {result.filesLeft} stored file(s) could not be removed. Tell Elliot support so they can remove them.
          </p>
        )}
        {onClose ? (
          <button type="button" onClick={onClose} className={`${btn.secondary} ${btn.small} w-fit`}>
            Done
          </button>
        ) : (
          <a href="/dashboard/conversations" className={`${btn.secondary} ${btn.small} w-fit`}>
            Back to conversations
          </a>
        )}
      </div>
    </Panel>
  );
}

// On the conversations list, right after a client was deleted.
export function ErasedNotice() {
  const [result, setResult] = useState<Erased | null>(null);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(ERASED_KEY);
      if (raw) {
        sessionStorage.removeItem(ERASED_KEY);
        setResult(JSON.parse(raw));
      }
    } catch {
      /* nothing to show */
    }
  }, []);
  if (!result) return null;
  return (
    <div className="mb-5 max-w-xl">
      <ErasedDetails result={result} onClose={() => setResult(null)} />
    </div>
  );
}
