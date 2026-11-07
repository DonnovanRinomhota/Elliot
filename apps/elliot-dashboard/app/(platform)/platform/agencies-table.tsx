"use client";

import { useMemo, useState } from "react";
import {
  ACCOUNT_STATE_LABEL,
  accountState,
  aiCostUsd,
  healthIssues,
  relativeDays,
  type AccountState,
  type TenantOverviewRow,
} from "@/lib/platform";
import { Badge, EmptyState, PER_PAGE, btn, pageWindow, timeAgo, type Tone } from "../../_ui/ui";

const STATE_TONE: Record<AccountState, Tone> = {
  trial: "brass",
  trial_ended: "alert",
  active: "ink",
  past_due: "alert",
  complimentary: "neutral",
  suspended: "muted",
  cancelled: "muted",
};

const n = (v: number | string | null | undefined) => Number(v || 0);

export default function AgenciesTable({ rows }: { rows: TenantOverviewRow[] }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"" | AccountState>("");
  const [page, setPage] = useState(1);
  const now = useMemo(() => new Date(), []);

  const enriched = useMemo(
    () =>
      rows.map((r) => {
        const s = accountState(r, now);
        return { r, s, issues: healthIssues(r, s, now), cost: aiCostUsd(n(r.input_tokens), n(r.output_tokens)) };
      }),
    [rows, now]
  );

  const shown = enriched.filter(({ r, s }) => {
    if (state && s !== state) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [r.name, r.slug, r.contact_email].some((v) => (v || "").toLowerCase().includes(q));
  });

  const pages = Math.max(1, Math.ceil(shown.length / PER_PAGE));
  const current = Math.min(page, pages);
  const offset = (current - 1) * PER_PAGE;
  const pageRows = shown.slice(offset, offset + PER_PAGE);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="agency-search">
          Search agencies
        </label>
        <input
          id="agency-search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Search by name, slug or contact email"
          className="h-9 min-w-[240px] flex-1 px-3"
        />
        <label className="sr-only" htmlFor="agency-state">
          Account status
        </label>
        <select
          id="agency-state"
          value={state}
          onChange={(e) => {
            setState(e.target.value as AccountState | "");
            setPage(1);
          }}
          className="h-9 px-3"
        >
          <option value="">All statuses</option>
          {(Object.keys(ACCOUNT_STATE_LABEL) as AccountState[]).map((k) => (
            <option key={k} value={k}>
              {ACCOUNT_STATE_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      {shown.length === 0 ? (
        <EmptyState title={rows.length ? "No agencies match" : "No agencies yet"}>
          {rows.length ? "Try a different search or status." : "Add your first agency with Add agency above."}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto card">
          <table className="w-full min-w-[980px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-gray-200 text-[12px] text-gray-500">
                <th className="px-4 py-2.5 font-medium">#</th>
                <th className="px-4 py-2.5 font-medium">Agency</th>
                <th className="px-4 py-2.5 font-medium">Account</th>
                <th className="px-4 py-2.5 font-medium">Trial / paid until</th>
                <th className="px-4 py-2.5 text-right font-medium">Chats</th>
                <th className="px-4 py-2.5 text-right font-medium">Leads</th>
                <th className="px-4 py-2.5 text-right font-medium">Viewings</th>
                <th className="px-4 py-2.5 text-right font-medium">AI cost</th>
                <th className="px-4 py-2.5 font-medium">Health</th>
                <th className="px-4 py-2.5 font-medium">Last activity</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {pageRows.map(({ r, s, issues, cost }, i) => {
                const dateIso = r.plan === "trial" ? r.trial_ends_at : r.paid_until;
                return (
                  <tr key={r.tenant_id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                    <td className="tabular px-4 py-3 text-gray-400">{offset + i + 1}</td>
                    <td className="px-4 py-3">
                      <a href={`/platform/tenants/${r.tenant_id}`} className="font-medium text-ink no-underline hover:underline">
                        {r.name}
                      </a>
                      <div className="text-[12px] text-gray-500">
                        {r.slug} · {n(r.users_count)} user{n(r.users_count) === 1 ? "" : "s"} · {n(r.listings_count)} listing
                        {n(r.listings_count) === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATE_TONE[s]}>{ACCOUNT_STATE_LABEL[s]}</Badge>
                      <div className="mt-1 text-[12px] text-gray-500">
                        <span className="capitalize">{r.plan}</span>
                        {r.monthly_price != null && r.plan !== "trial" && r.plan !== "complimentary" ? ` · €${n(r.monthly_price)}/mo` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {dateIso && r.plan !== "complimentary" ? (
                        <>
                          <div className="text-ink">{new Date(dateIso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</div>
                          <div className={`text-[12px] ${new Date(dateIso) < now ? "text-alert" : "text-gray-500"}`}>{relativeDays(dateIso, now)}</div>
                        </>
                      ) : (
                        <span className="text-gray-400">–</span>
                      )}
                    </td>
                    <td className="tabular px-4 py-3 text-right">{n(r.conversations_count)}</td>
                    <td className="tabular px-4 py-3 text-right">
                      {n(r.leads_count)}
                      {n(r.hot_leads_count) > 0 && <div className="text-[12px] text-alert">{n(r.hot_leads_count)} hot</div>}
                    </td>
                    <td className="tabular px-4 py-3 text-right">{n(r.appointments_count)}</td>
                    <td className="tabular px-4 py-3 text-right" title={`${n(r.ai_replies)} replies, ${n(r.input_tokens).toLocaleString("en-GB")} in / ${n(r.output_tokens).toLocaleString("en-GB")} out tokens`}>
                      ${cost.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      {issues.length === 0 ? (
                        <span className="text-gray-500">OK</span>
                      ) : (
                        <ul className="m-0 list-none p-0 text-[12.5px] text-alert">
                          {issues.slice(0, 2).map((i) => (
                            <li key={i}>{i}</li>
                          ))}
                          {issues.length > 2 && <li className="text-gray-500">+{issues.length - 2} more</li>}
                        </ul>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">{r.last_activity_at ? timeAgo(r.last_activity_at) : "Never"}</td>
                    <td className="px-4 py-3 text-right">
                      <a href={`/platform/tenants/${r.tenant_id}`} className={`${btn.secondary} ${btn.small}`}>
                        Manage
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {shown.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[13px]">
          <span className="tabular text-gray-500">
            {offset + 1}–{offset + pageRows.length} of {shown.length} agencies
          </span>
          {pages > 1 && (
            <div className="flex items-center gap-1">
              <button type="button" disabled={current === 1} onClick={() => setPage(current - 1)} className={`${btn.secondary} ${btn.small}`}>
                Previous
              </button>
              {pageWindow(current, pages).map((p, i) =>
                p === "…" ? (
                  <span key={`g${i}`} className="px-2 text-gray-400">…</span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPage(p)}
                    aria-current={p === current ? "page" : undefined}
                    className={`tabular h-8 min-w-8 rounded-full px-2.5 ${p === current ? "bg-accent font-medium text-white" : "text-gray-600 hover:bg-ink-soft"}`}
                  >
                    {p}
                  </button>
                )
              )}
              <button type="button" disabled={current === pages} onClick={() => setPage(current + 1)} className={`${btn.secondary} ${btn.small}`}>
                Next
              </button>
            </div>
          )}
        </div>
      )}
      <p className="mt-3 text-[12px] text-gray-400">
        AI cost is calculated from the token counts Elliot records for each reply, at the prices set in AI_PRICE_INPUT_PER_MTOK /
        AI_PRICE_OUTPUT_PER_MTOK (USD per million tokens). Counting starts once the updated workflow 01 is imported.
      </p>
    </div>
  );
}
