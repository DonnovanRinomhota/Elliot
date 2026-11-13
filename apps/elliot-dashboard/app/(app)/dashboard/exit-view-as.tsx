"use client";

import { useState } from "react";

export default function ExitViewAs() {
  const [busy, setBusy] = useState(false);
  async function exit() {
    setBusy(true);
    await fetch("/api/platform/view-as", { method: "DELETE" });
    window.location.href = "/platform";
  }
  return (
    <button
      type="button"
      onClick={exit}
      disabled={busy}
      className="rounded-md border border-brass/40 bg-glass px-3 py-1 text-[13px] font-medium text-brass-dark hover:bg-brass-soft"
    >
      {busy ? "Leaving…" : "Back to control panel"}
    </button>
  );
}
