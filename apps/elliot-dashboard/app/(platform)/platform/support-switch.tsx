"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// 0041: whether agencies must allow support access before you can open their
// dashboard. Off while testing; turn it on before the first real client.
export default function SupportSwitch({ required }: { required: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function flip() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/platform/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ support_permission_required: !required }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok || !data?.success) return setError(data?.error || "Couldn't change it.");
    router.refresh();
  }

  return (
    <section
      className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-[13px] ${
        required ? "border-gray-200 bg-white" : "border-brass/25 bg-brass-soft text-brass-dark"
      }`}
    >
      <div className="min-w-0">
        <strong className="font-semibold">
          {required ? "Agencies' permission is required" : "Testing mode: agencies' permission isn't required"}
        </strong>
        <span className="block text-[12.5px] opacity-90">
          {required
            ? "You can open an agency's dashboard only while they allow support access in their Settings."
            : "You can open any agency's dashboard (with two-step sign-in; visits are still recorded). Turn this on before your first real client."}
        </span>
        {error && <span className="block text-[12.5px] text-alert">{error}</span>}
      </div>
      <button
        type="button"
        onClick={flip}
        disabled={busy}
        className="h-9 shrink-0 cursor-pointer rounded-full border-0 gold-fill px-3.5 text-[13px] font-semibold text-ink shadow-gold hover:brightness-[1.04] disabled:opacity-50"
      >
        {busy ? "Saving…" : required ? "Pause for testing" : "Require permission"}
      </button>
    </section>
  );
}
