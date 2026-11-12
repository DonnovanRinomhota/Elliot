// Shared building blocks for the dashboard's look. Plain components with no
// hooks (the sticky page header is its own small client component), so both
// server and client components can use them.
//
// Colour rules (see tailwind.config.ts): gold for the main action, ink for
// normal emphasis, brass for "waiting on you", alert for urgent/destructive,
// greys for everything else.
import type { ReactNode } from "react";
import StickyHeader from "./sticky-header";

// ── Buttons (class strings, so <a>, <button> and <summary> can all use them) ──

const BTN = "inline-flex items-center justify-center gap-1.5 rounded-full text-[13px] font-medium no-underline transition-colors disabled:cursor-not-allowed disabled:opacity-50";
export const btn = {
  /** Gold, like the website's "Request a demo". */
  primary: `${BTN} gold-fill h-9 px-4 font-semibold text-ink shadow-gold hover:brightness-[1.04]`,
  /** Navy, for a second strong action next to a gold one. */
  dark: `${BTN} h-9 bg-ink px-4 text-white shadow-sm hover:bg-ink-800`,
  secondary: `${BTN} h-9 border border-gray-200 bg-white px-4 text-ink shadow-sm hover:border-gray-300 hover:bg-gray-50`,
  danger: `${BTN} h-9 border border-alert/30 bg-white px-4 text-alert hover:bg-alert-soft`,
  ghost: `${BTN} h-9 px-3 text-ink-600 hover:bg-white hover:text-ink`,
  /** Low-emphasis destructive action (e.g. Reject next to a primary button). */
  dangerGhost: `${BTN} h-9 px-3 text-alert hover:bg-alert-soft`,
  small: "!h-8 !px-3 !text-[12.5px]",
};

// ── Page header ──

/** Page title, description, buttons and status tabs. Stays at the top while the page scrolls. */
export function PageHeader({
  title,
  description,
  actions,
  tabs,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
}) {
  return <StickyHeader title={title} description={description} actions={actions} tabs={tabs} />;
}

/**
 * Page description that switches to "N items from the last X days. Show all"
 * when a list page is opened from an Overview figure with ?days=.
 */
export function FilterDescription({
  days,
  count,
  noun,
  clearHref,
  children,
}: {
  days: number | null;
  count: number;
  noun: [singular: string, plural: string];
  clearHref: string;
  children: ReactNode;
}) {
  if (!days) return <>{children}</>;
  return (
    <>
      {count} {count === 1 ? noun[0] : noun[1]} from the last {days} days.{" "}
      <a href={clearHref} className="text-ink underline">
        Show all
      </a>
    </>
  );
}

// ── Panels ──

export function Panel({
  title,
  action,
  children,
  className = "",
  flush = false,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** No inner padding -- for tables and lists that run edge to edge. */
  flush?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-5 pb-1 pt-5">
          {title && <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>}
          {action}
        </div>
      )}
      <div className={flush ? "pt-2" : "p-5"}>{children}</div>
    </section>
  );
}

// ── Badges ──

export type Tone = "neutral" | "muted" | "ink" | "brass" | "alert";

const TONE: Record<Tone, string> = {
  neutral: "bg-gray-100 text-gray-700",
  muted: "bg-transparent text-gray-500 ring-1 ring-inset ring-gray-200",
  ink: "bg-accent-soft text-accent-dark",
  brass: "bg-brass-soft text-brass-dark",
  alert: "bg-alert-soft text-alert-dark",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

const ACRONYMS: Record<string, string> = { whatsapp: "WhatsApp", faq: "FAQ", crm: "CRM", pdf: "PDF", url: "URL" };

/** "no_show" -> "No show", "QUALIFYING" -> "Qualifying", "faq" -> "FAQ". */
export function humanize(value: string): string {
  const s = value
    .replace(/_/g, " ")
    .toLowerCase()
    .split(" ")
    .map((w) => ACRONYMS[w] ?? w)
    .join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// One mapping per kind of status, so the same word always looks the same.
const STATUS_TONES: Record<string, Record<string, Tone>> = {
  lead: { NEW: "neutral", QUALIFYING: "neutral", WARM: "brass", HOT: "alert", COLD: "muted", CONVERTED: "ink", LOST: "muted" },
  appointment: { confirmed: "ink", completed: "neutral", cancelled: "muted", no_show: "alert", rescheduled: "brass" },
  escalation: { open: "alert", acknowledged: "brass", resolved: "muted" },
  priority: { urgent: "alert", high: "alert", normal: "neutral", low: "muted" },
  draft: { pending: "brass", approved: "ink", sent: "neutral", auto_sent: "neutral", rejected: "muted", blocked_needs_template: "alert" },
  conversation: { open: "ink", escalated: "alert", closed: "muted" },
};

export function StatusBadge({ kind, value }: { kind: keyof typeof STATUS_TONES; value: string }) {
  return <Badge tone={STATUS_TONES[kind]?.[value] ?? "neutral"}>{humanize(value)}</Badge>;
}

// ── Feedback ──

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-[22px] border border-dashed border-gray-300 bg-white/80 px-6 py-10 text-center">
      <p className="m-0 text-[14px] font-medium text-ink">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-[13px] text-gray-500">{children}</div>}
    </div>
  );
}

export function Notice({ tone = "neutral", children }: { tone?: "neutral" | "brass" | "alert"; children: ReactNode }) {
  const styles = {
    neutral: "border-gray-200 bg-white text-gray-600",
    brass: "border-brass/25 bg-brass-soft text-brass-dark",
    alert: "border-alert/25 bg-alert-soft text-alert-dark",
  }[tone];
  return <div className={`rounded-xl border px-3.5 py-2.5 text-[13px] ${styles}`}>{children}</div>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 text-[13px] text-alert" role="alert">
      {children}
    </p>
  );
}

// ── Dates ──

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  return new Date(iso).toLocaleDateString("en-GB", opts);
}

export function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

// ── Pagination ──

/** Rows per page on every list. */
export const PER_PAGE = 20;
/** Listings have photos, so their pages are shorter. */
export const LISTINGS_PER_PAGE = 12;

/** One page of a list, plus what the Pagination bar needs. Pages start at 1. */
export function paginate<T>(items: T[], pageParam?: string | null, perPage = PER_PAGE) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const requested = Number.parseInt(pageParam || "1", 10);
  const page = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), pages) : 1;
  const offset = (page - 1) * perPage;
  return { items: items.slice(offset, offset + perPage), page, pages, total, offset };
}

/** Page numbers to show: always first and last, the current one and its neighbours, "…" between. */
export function pageWindow(page: number, pages: number): (number | "…")[] {
  const set = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  // A gap of exactly one page shows that page instead of "…".
  Array.from(set).forEach((n) => {
    if (set.has(n + 2) && !set.has(n + 1)) set.add(n + 1);
  });
  const sorted = Array.from(set).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push("…");
    out.push(n);
  });
  return out;
}

/**
 * "13–24 of 152" with Previous / page numbers / Next. Plain links that keep
 * the page's other filters (params). Renders nothing for a single page.
 */
export function Pagination({
  page,
  pages,
  total,
  offset,
  shown,
  basePath,
  params = {},
  noun = "items",
}: {
  page: number;
  pages: number;
  total: number;
  offset: number;
  shown: number;
  basePath: string;
  params?: Record<string, string | undefined>;
  noun?: string;
}) {
  if (total === 0) return null;
  const href = (p: number) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) q.set(k, v);
    });
    if (p > 1) q.set("page", String(p));
    const qs = q.toString();
    return `${basePath}${qs ? `?${qs}` : ""}`;
  };
  const cell = "inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2.5 text-[13px] no-underline";
  return (
    <nav aria-label="Pages" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <span className="tabular text-[13px] text-gray-500">
        {offset + 1}–{offset + shown} of {total} {noun}
      </span>
      {pages > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          {page > 1 ? (
            <a href={href(page - 1)} className={`${cell} border border-gray-200 bg-white text-ink hover:bg-gray-50`}>
              Previous
            </a>
          ) : (
            <span className={`${cell} border border-gray-200 text-gray-400`}>Previous</span>
          )}
          {pageWindow(page, pages).map((p, i) =>
            p === "…" ? (
              <span key={`gap-${i}`} className={`${cell} text-gray-400`}>
                …
              </span>
            ) : (
              <a
                key={p}
                href={href(p)}
                aria-current={p === page ? "page" : undefined}
                className={`${cell} tabular ${p === page ? "bg-ink font-semibold text-white" : "text-gray-600 hover:bg-white hover:text-ink"}`}
              >
                {p}
              </a>
            )
          )}
          {page < pages ? (
            <a href={href(page + 1)} className={`${cell} border border-gray-200 bg-white text-ink hover:bg-gray-50`}>
              Next
            </a>
          ) : (
            <span className={`${cell} border border-gray-200 text-gray-400`}>Next</span>
          )}
        </div>
      )}
    </nav>
  );
}

/** Row number shown at the start of numbered lists. */
export function RowNumber({ n }: { n: number }) {
  return <span className="tabular text-[12.5px] text-gray-400">{n}</span>;
}
