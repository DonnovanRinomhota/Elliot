"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { checkAsariCredentials, splitPastedCredentials, syncState, syncSummary, type AsariStatus } from "@/lib/asari";

// 0044: listings from ASARI CRM. The admin pastes the API user ID and token
// once; Elliot copies the agency's exported listings every hour.
export default function AsariCard({ status, canChange, timeZone }: { status: AsariStatus; canChange: boolean; timeZone: string }) {
  const router = useRouter();
  const connected = status.connected;
  const [userId, setUserId] = useState(connected ? status.api_user_id : "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "sync" | "remove">("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const state = syncState(status);
  const when = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  function onUserId(v: string) {
    const both = splitPastedCredentials(v);
    if (both) {
      setUserId(both.userId);
      setToken(both.token);
    } else setUserId(v);
  }

  async function call(kind: "save" | "sync" | "remove") {
    setMessage(null);
    if (kind === "save") {
      const problem = checkAsariCredentials(userId, token, !connected);
      if (problem) return setMessage({ ok: false, text: problem });
    }
    if (kind === "remove" && !window.confirm("Disconnect ASARI? Listings already copied stay in Elliot, but stop updating.")) return;
    setBusy(kind);
    const res = await fetch(kind === "sync" ? "/api/integrations/asari/sync" : "/api/integrations/asari", {
      method: kind === "remove" ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      body: kind === "save" ? JSON.stringify({ api_user_id: userId, api_token: token }) : undefined,
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    setBusy("");
    if (!res || !data?.success) return setMessage({ ok: false, text: data?.error || "Something went wrong. Try again." });
    setToken("");
    setMessage({
      ok: true,
      text:
        kind === "remove"
          ? "Disconnected."
          : kind === "sync" || data.syncing
            ? "Syncing. New listings take about 3 seconds each; refresh this page in a minute."
            : "Saved.",
    });
    router.refresh();
  }

  const dot = { off: "bg-gray-300", paused: "bg-gray-300", waiting: "bg-brass", ok: "bg-accent", error: "bg-alert" }[state];

  return (
    <section className="mb-6 card">
      <header className="border-b border-gray-100 px-5 py-4">
        <h2 className="m-0 text-[15px] font-semibold text-ink">ASARI CRM</h2>
        <p className="m-0 mt-0.5 text-[13px] text-gray-500">
          Elliot copies the listings you export from ASARI every hour, so it can offer them to clients. Change listings in ASARI; changes made in Elliot are replaced on the next update.
        </p>
      </header>
      <div className="p-5">
        <p className="m-0 mb-3 flex items-start gap-2 text-[13.5px] text-ink">
          <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
          <span>
            {!status.connected ? (
              <span className="text-gray-600">Not connected.</span>
            ) : state === "paused" ? (
              <span>Paused.</span>
            ) : state === "waiting" ? (
              <span>Connected. The first sync starts within the hour, or press Sync now.</span>
            ) : (
              <>
                <strong className="font-semibold">{state === "ok" ? "Working." : "Last sync failed."}</strong>{" "}
                <span className="text-gray-600">
                  {status.listings} available listing{status.listings === 1 ? "" : "s"} from ASARI. Last sync {when(status.last_sync_at!)}
                  {state === "ok" && status.last_sync_counts ? `: ${syncSummary(status.last_sync_counts)}.` : "."}
                </span>
                {state === "error" && status.last_sync_error && (
                  <span className="mt-1 block text-[12.5px] text-alert">{status.last_sync_error}</span>
                )}
              </>
            )}
          </span>
        </p>

        {!canChange ? (
          <p className="m-0 text-[12.5px] text-gray-500">Only an admin of your agency can change this.</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-[13px] font-medium text-ink">
                API user ID
                <input
                  className="mt-1 h-9 w-full px-2.5 text-[13.5px]"
                  value={userId}
                  onChange={(e) => onUserId(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="e.g. 12345"
                />
              </label>
              <label className="block text-[13px] font-medium text-ink">
                API token
                <input
                  className="mt-1 h-9 w-full px-2.5 text-[13.5px]"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="new-password"
                  spellCheck={false}
                  placeholder={connected ? "Saved. Leave empty to keep it" : "From ASARI"}
                />
              </label>
            </div>
            <p className="m-0 mt-2 text-[12.5px] text-gray-500">
              These come from ASARI&apos;s site API (apiSite). If you don&apos;t have them, ask ASARI support for an apiSite user ID and token for your website export. The token is stored securely and never shown again.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => call("save")}
                disabled={!!busy}
                className="inline-flex h-9 cursor-pointer items-center rounded-full border-0 gold-fill px-3.5 text-[13px] font-semibold text-ink shadow-gold hover:brightness-[1.04] disabled:opacity-50"
              >
                {busy === "save" ? "Saving…" : connected ? "Save changes" : "Connect ASARI"}
              </button>
              {connected && (
                <>
                  <button
                    type="button"
                    onClick={() => call("sync")}
                    disabled={!!busy}
                    className="inline-flex h-9 cursor-pointer items-center rounded-full border border-gray-200 bg-white px-3.5 text-[13px] font-medium text-ink hover:bg-gray-50 disabled:opacity-50"
                  >
                    {busy === "sync" ? "Starting…" : "Sync now"}
                  </button>
                  <button
                    type="button"
                    onClick={() => call("remove")}
                    disabled={!!busy}
                    className="inline-flex h-9 cursor-pointer items-center rounded-full border-0 bg-transparent px-2 text-[13px] font-medium text-gray-500 hover:text-alert disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                </>
              )}
            </div>
          </>
        )}
        {message && <p className={`m-0 mt-3 text-[12.5px] ${message.ok ? "text-gray-600" : "text-alert"}`}>{message.text}</p>}
      </div>
    </section>
  );
}
