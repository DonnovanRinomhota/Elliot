"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Re-fetches the server component every `seconds` while the tab is visible,
// so the Inbox and a live chat update without a manual reload.
export default function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => window.clearInterval(id);
  }, [router, seconds]);
  return null;
}
