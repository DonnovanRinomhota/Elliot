"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { btn } from "../../../_ui/ui";

// Archive a finished conversation, or move it back. It also comes back by
// itself when the client writes again or someone from the agency replies
// (0052: archive_conversation and the triggers behind it).
export default function ArchiveButton({ conversationId, archived, onDark = false }: { conversationId: string; archived: boolean; onDark?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await createClient().rpc("archive_conversation", { p_conversation_id: conversationId, p_archive: !archived });
    setBusy(false);
    if (rpcError) {
      setError(/archive_conversation|function/i.test(rpcError.message) ? "Archiving isn't set up yet (database update 0052)." : rpcError.message);
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className={onDark ? "inline-flex h-9 items-center gap-1.5 rounded-full border border-white/30 bg-[#071a3a]/45 px-4 text-[13px] font-medium text-white hover:bg-[#071a3a]/65 disabled:opacity-50" : btn.secondary}
        title={archived ? "Back to the main list" : "Out of the way until the client or your team writes again"}
      >
        {archived ? <ArchiveRestore size={15} aria-hidden="true" /> : <Archive size={15} aria-hidden="true" />}
        {busy ? "…" : archived ? "Move back" : "Archive"}
      </button>
      {error && (
        <span role="alert" className={`text-[12px] ${onDark ? "text-[#ffc9c3]" : "text-alert"}`}>
          {error}
        </span>
      )}
    </span>
  );
}
