"use client";

import { useState } from "react";
import { btn } from "../../../../_ui/ui";

// Opens this agency's dashboard exactly as they see it (8 hours at most, never
// past the agency's permission, or until "Exit" in the banner). 0040: only
// when the agency allows support access; each part opened is shown to them.
export default function ViewAsButton({ tenantId, tenantName, allowed = true }: { tenantId: string; tenantName: string; allowed?: boolean }) {
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
      <button
        type="button"
        onClick={start}
        disabled={busy || !allowed}
        className={btn.primary}
        title={allowed ? `See ${tenantName}'s dashboard as they do` : `${tenantName} hasn't allowed support access`}
      >
        {busy ? "Opening…" : "Open their dashboard"}
      </button>
    </div>
  );
}
