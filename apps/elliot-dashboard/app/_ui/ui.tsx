// Shared building blocks for the dashboard's look. Plain components with no
// hooks, so both server and client components can use them.
//
// Colour rules (see tailwind.config.ts): ink for normal emphasis, brass for
// "waiting on you", alert for urgent/destructive, greys for everything else.
import type { ReactNode } from "react";

// ── Buttons (class strings, so <a>, <button> and <summary> can all use them) ──

const BTN = "inline-flex items-center justify-center gap-1.5 rounded-md text-[13px] font-medium no-underline transition-colors disabled:cursor-not-allowed disabled:opacity-50";
export const btn = {
  primary: `${BTN} h-9 bg-ink px-3.5 text-white hover:bg-ink-800`,
  secondary: `${BTN} h-9 border border-gray-300 bg-white px-3.5 text-ink hover:border-ink-400 hover:bg-ink-soft`,
  danger: `${BTN} h-9 border border-alert/30 bg-white px-3.5 text-alert hover:bg-alert-soft`,
  ghost: `${BTN} h-9 px-2.5 text-ink-600 hover:bg-ink-soft hover:text-ink`,
  /** Low-emphasis destructive action (e.g. Reject next to a primary button). */
  dangerGhost: `${BTN} h-9 px-2.5 text-alert hover:bg-alert-soft`,
  small: "!h-8 !px-3 !text-[12.5px]",
};

// ── Page header ──

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="m-0 text-[22px] font-semibold leading-tight tracking-[-0.01em] text-ink">{title}</h1>
        {description && <p className="mb-0 mt-1 max-w-2xl text-[13.5px] text-gray-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
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
    <section className={`rounded-lg border border-gray-200 bg-white ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-3.5">
          {title && <h2 className="m-0 text-[14px] font-semibold text-ink">{title}</h2>}
          {action}
        </div>
      )}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </section>
  );
}

// ── Badges ──

export type Tone = "neutral" | "muted" | "ink" | "brass" | "alert";

const TONE: Record<Tone, string> = {
  neutral: "bg-gray-100 text-gray-700",
  muted: "bg-transparent text-gray-500 ring-1 ring-inset ring-gray-200",
  ink: "bg-ink-soft text-ink",
  brass: "bg-brass-soft text-brass-dark",
  alert: "bg-alert-soft text-alert-dark",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded px-2 py-0.5 text-[12px] font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

const ACRONYMS: Record<string, string> = { faq: "FAQ", crm: "CRM", pdf: "PDF", url: "URL" };

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
    <div className="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
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
  return <div className={`rounded-md border px-3.5 py-2.5 text-[13px] ${styles}`}>{children}</div>;
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
