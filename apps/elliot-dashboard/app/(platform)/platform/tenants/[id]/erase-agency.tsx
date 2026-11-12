"use client";

import { useState } from "react";
import { btn } from "../../../../_ui/ui";

// An agency that has left: delete everything Elliot holds for them (0051).
// Shown only once the agency is Cancelled; the database checks that again and
// wants the short name typed. Export anything they asked for first.
export default function EraseAgency({ tenantId, slug, name }: { tenantId: string; slug: string; name: string }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function erase() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/platform/tenants/${tenantId}/erase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: typed.trim() }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok || !data?.success) return setError(data?.error || `Couldn't delete (${res.status}).`);
    const c = data.counts ?? {};
    const left = [
      data.files_not_removed ? `${data.files_not_removed} file(s)` : "",
      data.logins_not_removed ? `${data.logins_not_removed} login(s)` : "",
    ].filter(Boolean);
    setDone(
      `${name} deleted: ${c.contacts ?? 0} contacts, ${c.conversations ?? 0} conversations, ${c.messages ?? 0} messages, ${c.listings ?? 0} listings, ${c.team ?? 0} team members.` +
        (left.length ? ` Not removed, check Supabase by hand: ${left.join(", ")}.` : "")
    );
  }

  if (done) {
    return (
      <div className="grid gap-3 text-[13px]">
        <p className="m-0 text-ink">{done}</p>
        <a href="/platform" className={`${btn.secondary} ${btn.small} w-fit`}>
          Back to agencies
        </a>
      </div>
    );
  }

  return (
    <div className="grid gap-2 text-[13px]">
      <p className="m-0 text-gray-600">
        Permanently deletes this agency: clients, conversations, messages, files, listings, settings, its team&apos;s logins and its
        connections. It can&apos;t be undone. A record that it happened stays in your activity log. Export anything they asked for first.
      </p>
      <label htmlFor="erase-slug" className="font-medium text-gray-700">
        Type <strong>{slug}</strong> to confirm
      </label>
      <input id="erase-slug" value={typed} onChange={(e) => setTyped(e.target.value)} className="h-9 w-full max-w-xs px-3" autoComplete="off" />
      {error && (
        <p className="m-0 text-alert" role="alert">
          {error}
        </p>
      )}
      <button type="button" onClick={erase} disabled={busy || typed.trim() !== slug} className={`${btn.danger} w-fit`}>
        {busy ? "Deleting…" : "Delete all of this agency's data"}
      </button>
    </div>
  );
}
