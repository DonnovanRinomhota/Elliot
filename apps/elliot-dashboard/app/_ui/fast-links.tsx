"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Pages use plain <a> links in many places. This turns a click on any link to
// another dashboard page into an in-app change (only the page's content
// loads; the sidebar and its scroll position stay), instead of reloading the
// whole app. Links that must load for real are left alone: other sites, new
// tabs, downloads, /api and the sign-in pages.
const SKIP = /^\/(api|auth|login|logout|forgot-password|reset-password|two-step|p\/)/;

export default function FastLinks() {
  const router = useRouter();
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || !a.href || a.target || a.hasAttribute("download") || a.dataset.reload !== undefined) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || SKIP.test(url.pathname)) return;
      // Same page, only a #section: let the browser scroll.
      if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
      e.preventDefault();
      a.closest("details[open]")?.removeAttribute("open"); // the phone menu
      router.push(url.pathname + url.search + url.hash);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [router]);
  return null;
}
