"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ACCESS_OPTIONS, supportAccessState, untilLabel, type Grant } from "@/lib/support-access";

type Visit = { id: number; admin_email: string; section: string; viewed_at: string };

// 0040: the agency decides when the Elliot team may open its dashboard, and
// sees every part they opened. Only the agency's admins can change it.
export default function SupportAccessCard({
  grant,
  visits,
  canChange,
  timeZone,
  viewingAsSupport,
  required = true,
}: {
  grant: Grant;
  visits: Visit[];
  canChange: boolean;
  timeZone: string;
  viewingAsSupport: boolean;
  required?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [hours, setHours] = useState<number>(ACCESS_OPTIONS[0].hours);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = supportAccessState(grant, "agency");
  const when = (iso: string) => untilLabel(iso, timeZone);

  async function allow() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("grant_support_access", { p_hours: hours });
    setBusy(false);
    if (error) return setError(error.message);
    router.refresh();
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("revoke_support_access");
    setBusy(false);
    if (error) return setError(error.message);
    router.refresh();
  }

  return (
    <section className="mb-6 card">
      <header className="border-b border-gray-100 px-5 py-4">
        <h2 className="m-0 text-[15px] font-semibold text-ink">Elliot support access</h2>
        <p className="m-0 mt-0.5 text-[13px] text-gray-500">
          The Elliot team can open your dashboard, including your clients&apos; conversations and details, only while you allow it.
        </p>
      </header>
      <div className="p-5">
        <p className="m-0 mb-3 flex items-start gap-2 text-[13.5px] text-ink">
          <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${state.open ? "bg-accent" : "bg-gray-300"}`} aria-hidden />
          <span>
            {state.open && state.reason === "granted" ? (
              <>
                <strong className="font-semibold">On</strong> until {when(state.until)}
                {state.by === "Elliot set-up" ? (
                  <span className="text-gray-500">, while Elliot is being set up for you</span>
                ) : state.by ? (
                  <span className="text-gray-500">, allowed by {state.by}</span>
                ) : null}
              </>
            ) : (
              <>
                <strong className="font-semibold">Off.</strong>{" "}
                <span className="text-gray-600">Turn it on when you ask for help, or while Elliot is being set up for you.</span>
              </>
            )}
          </span>
        </p>

        {!required && (
          <p className="m-0 mb-3 rounded-lg bg-brass-soft px-3 py-2 text-[12.5px] text-brass-dark">
            Elliot is in testing: the Elliot team can currently open your dashboard without this permission. Every visit is still listed below.
          </p>
        )}
        {viewingAsSupport ? (
          <p className="m-0 mb-3 text-[12.5px] text-gray-500">Only the agency&apos;s own admins can change this.</p>
        ) : !canChange ? (
          <p className="m-0 mb-3 text-[12.5px] text-gray-500">Only an admin of your agency can change this.</p>
        ) : (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {state.open ? (
              <button
                type="button"
                onClick={turnOff}
                disabled={busy}
                className="inline-flex h-9 cursor-pointer items-center rounded-full border border-gray-200 bg-white px-3.5 text-[13px] font-medium text-ink hover:bg-gray-50 disabled:opacity-50"
              >
                {busy ? "Turning off…" : "Turn off now"}
              </button>
            ) : null}
            <select
              aria-label="How long"
              className="h-9 px-2 text-[13px]"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            >
              {ACCESS_OPTIONS.map((o) => (
                <option key={o.hours} value={o.hours}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={allow}
              disabled={busy}
              className="inline-flex h-9 cursor-pointer items-center rounded-full border-0 bg-ink px-3.5 text-[13px] font-medium text-white hover:bg-ink-800 disabled:opacity-50"
            >
              {state.open ? "Change to this" : "Allow access"}
            </button>
          </div>
        )}
        {error && <p className="m-0 mb-3 text-[12.5px] text-alert">{error}</p>}

        <div className="border-t border-gray-100 pt-3">
          <h3 className="m-0 mb-1.5 text-[13px] font-semibold text-ink">What support opened</h3>
          {visits.length ? (
            <ul className="m-0 list-none p-0 text-[13px]">
              {visits.map((v) => (
                <li key={v.id} className="flex flex-wrap justify-between gap-x-3 border-b border-gray-50 py-1.5 last:border-0">
                  <span className="text-ink">{v.section}</span>
                  <span className="text-[12.5px] text-gray-500">
                    {when(v.viewed_at)} · {v.admin_email}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[12.5px] text-gray-500">Nobody from Elliot has opened your dashboard.</p>
          )}
        </div>
      </div>
    </section>
  );
}
