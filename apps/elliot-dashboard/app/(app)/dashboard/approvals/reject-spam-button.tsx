"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { btn } from "../../../_ui/ui";

// "Reject N spam drafts": asks once more on the button itself, then rejects
// every waiting draft Elliot classed as spam (POST /api/drafts/reject-spam).
export default function RejectSpamButton({ count }: { count: number }) {
  const router = useRouter();
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/drafts/reject-spam", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || `Error ${res.status}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      setSure(false);
    }
  }

  return (
    <span className="flex flex-col items-end gap-1.5">
      <span className="flex flex-wrap items-center gap-2">
        {sure && !busy && (
          <button type="button" onClick={() => setSure(false)} className={`${btn.ghost} !text-white hover:!bg-white/10`}>
            Keep them
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => (sure ? run() : setSure(true))} className={`${btn.primary} !h-10 !px-4`}>
          <Trash2 size={15} aria-hidden="true" />
          {busy ? "Rejecting…" : sure ? `Yes, reject ${count}` : `Reject ${count} spam draft${count === 1 ? "" : "s"}`}
        </button>
      </span>
      {error && (
        <span role="alert" className="text-[12.5px] text-[#ffc9c3]">
          {error}
        </span>
      )}
    </span>
  );
}
