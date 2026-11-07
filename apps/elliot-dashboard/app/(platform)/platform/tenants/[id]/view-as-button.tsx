"use client";

import { useState } from "react";
import { btn } from "../../../../_ui/ui";

// Opens this agency's dashboard exactly as they see it (8 hours, or until
// "Exit" in the banner). Useful for support: no password sharing.
export default function ViewAsButton({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/platform/view-as", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: tenantId }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      setBusy(false);
      setError(data?.error || "Couldn't open their dashboard.");
      return;
    }
    window.location.href = "/";
  }

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-[13px] text-alert">{error}</span>}
      <button type="button" onClick={start} disabled={busy} className={btn.primary} title={`See ${tenantName}'s dashboard as they do`}>
        {busy ? "Opening…" : "Open their dashboard"}
      </button>
    </div>
  );
}
