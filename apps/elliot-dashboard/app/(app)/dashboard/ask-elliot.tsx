"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, ChevronRight, Search, Sparkles, X } from "lucide-react";
import type { Answer, AnswerItem } from "@/lib/assistant/run";
import { EXAMPLES } from "@/lib/assistant/parse";

const OPEN_EVENT = "elliot:ask";

/** Opens the assistant from anywhere: `openAskElliot("viewings today")`. */
export function openAskElliot(question?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: question }));
}

/** The search-style box in the sidebar (and anywhere else) that opens the assistant. */
export function AskElliotButton({ compact = false }: { compact?: boolean }) {
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);
  if (compact) {
    return (
      <button
        type="button"
        onClick={() => openAskElliot()}
        className="inline-flex h-9 items-center gap-2 rounded-full border border-gray-200 bg-white px-4 text-[13px] font-medium text-ink shadow-sm hover:bg-gray-50"
      >
        <Sparkles size={15} className="text-accent" aria-hidden="true" />
        Ask Elliot
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => openAskElliot()}
      className="flex h-10 w-full items-center gap-2.5 rounded-xl border border-gray-200 bg-gray-50 px-3 text-left text-[13px] text-gray-500 hover:border-gray-300 hover:bg-white"
    >
      <Sparkles size={15} className="flex-shrink-0 text-accent" aria-hidden="true" />
      <span className="flex-1 truncate">Search or ask Elliot</span>
      <kbd className="rounded-md border border-gray-200 bg-white px-1.5 font-sans text-[11px] text-gray-400">{mac ? "⌘K" : "Ctrl K"}</kbd>
    </button>
  );
}

type Turn = { q: string; a: Answer | null; error?: string };

const BADGE: Record<NonNullable<AnswerItem["badge"]>["tone"], string> = {
  blue: "bg-accent-soft text-accent-dark",
  amber: "bg-brass-soft text-brass-dark",
  red: "bg-alert-soft text-alert-dark",
  gray: "bg-gray-100 text-gray-600",
};

// The built-in assistant. Answers from the agency's own data with simple
// rules (see lib/assistant): no AI service, nothing sent elsewhere.
export default function AskElliot() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const ask = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || busy) return;
      setQ("");
      setBusy(true);
      setTurns((t) => [...t.slice(-7), { q: text, a: null }]);
      try {
        const res = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: text }) });
        const a = (await res.json()) as Answer & { error?: string };
        if (!res.ok) throw new Error(a.error || "Couldn't answer that.");
        setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a } : x)));
        if (a.navigate) {
          setOpen(false);
          router.push(a.navigate);
        }
      } catch (e) {
        setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: (e as Error).message } : x)));
      } finally {
        setBusy(false);
      }
    },
    [busy, router]
  );

  // Open from the sidebar box, Ctrl/Cmd+K, or "/" when not typing.
  useEffect(() => {
    const onOpen = (e: Event) => {
      setOpen(true);
      const preset = (e as CustomEvent<string | undefined>).detail;
      if (preset) void ask(preset);
    };
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, [ask]);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 30);
  }, [open]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/25 px-3 pt-[8vh] backdrop-blur-[2px]" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ask Elliot"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-[680px] flex-col overflow-hidden rounded-[22px] border border-[#e8ebf1] bg-white shadow-lift"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(q);
          }}
          className="flex items-center gap-3 border-b border-gray-100 px-5 py-4"
        >
          <Search size={18} className="flex-shrink-0 text-gray-400" aria-hidden="true" />
          <label htmlFor="ask-elliot" className="sr-only">
            Ask Elliot
          </label>
          <input
            id="ask-elliot"
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask about leads, viewings, listings or people…"
            autoComplete="off"
            className="!h-9 flex-1 !border-0 !bg-transparent !p-0 text-[15.5px] !shadow-none placeholder:text-gray-400"
          />
          <button
            type="submit"
            disabled={!q.trim() || busy}
            aria-label="Ask"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-ink text-white disabled:bg-gray-200"
          >
            <ArrowUp size={16} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-ink">
            <X size={16} aria-hidden="true" />
          </button>
        </form>

        <div ref={scroller} className="flex-1 overflow-y-auto px-5 py-4">
          {turns.length === 0 ? (
            <div>
              <p className="m-0 flex items-center gap-2 text-[13px] font-medium text-ink">
                <Sparkles size={15} className="text-accent" aria-hidden="true" /> Try asking
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {EXAMPLES.map((ex) => (
                  <Chip key={ex} onClick={() => ask(ex)}>
                    {ex}
                  </Chip>
                ))}
              </div>
              <p className="mb-0 mt-5 text-[12px] text-gray-400">
                Answers come straight from your own data. Nothing is sent to an outside service.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5">
              {turns.map((t, i) => (
                <div key={i} className="grid min-w-0 grid-cols-1 gap-2.5">
                  <div className="max-w-[85%] justify-self-end rounded-2xl rounded-br-md bg-gray-100 px-3.5 py-2 text-[13.5px] text-ink">{t.q}</div>
                  {t.error ? (
                    <p className="m-0 text-[13.5px] text-alert">{t.error}</p>
                  ) : !t.a ? (
                    <p className="m-0 flex items-center gap-2 text-[13.5px] text-gray-500" role="status">
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" aria-hidden="true" />
                      Looking it up…
                    </p>
                  ) : (
                    <AnswerView a={t.a} onAsk={ask} onGo={() => setOpen(false)} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[12.5px] text-gray-700 hover:border-accent/40 hover:bg-accent-soft hover:text-accent-dark">
      {children}
    </button>
  );
}

function AnswerView({ a, onAsk, onGo }: { a: Answer; onAsk: (q: string) => void; onGo: () => void }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3">
      <p className="m-0 flex items-start gap-2 text-[15px] font-medium leading-snug text-ink">
        <Sparkles size={16} className="mt-0.5 flex-shrink-0 text-accent" aria-hidden="true" />
        {a.text}
      </p>
      {a.items && a.items.length > 0 && (
        <ul className="m-0 grid min-w-0 list-none grid-cols-1 gap-1 p-0">
          {a.items.map((it, i) => {
            const body = (
              <>
                {it.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.image} alt="" className="h-10 w-12 flex-shrink-0 rounded-lg bg-gray-100 object-cover" />
                ) : (
                  <span aria-hidden="true" className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent-dark">
                    {it.meta && /^\d+$/.test(it.meta) ? it.meta : it.title.replace(/[^\p{L}\d]/gu, "").slice(0, 1).toUpperCase() || "•"}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink">{it.title}</span>
                  {it.subtitle && <span className="block truncate text-[12.5px] text-gray-500">{it.subtitle}</span>}
                </span>
                {it.badge && <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${BADGE[it.badge.tone]}`}>{it.badge.label}</span>}
                {it.meta && !/^\d+$/.test(it.meta) && <span className="whitespace-nowrap text-[12px] text-gray-400">{it.meta}</span>}
                {it.href && <ChevronRight size={15} className="flex-shrink-0 text-gray-300" aria-hidden="true" />}
              </>
            );
            return (
              <li key={i} className="min-w-0">
                {it.href ? (
                  <a href={it.href} onClick={onGo} className="flex items-center gap-3 rounded-xl px-2 py-2 no-underline hover:bg-gray-50">
                    {body}
                  </a>
                ) : (
                  <div className="flex items-center gap-3 px-2 py-2">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {(a.more || a.suggestions?.length) && (
        <div className="flex flex-wrap items-center gap-2">
          {a.more && (
            <a href={a.more.href} onClick={onGo} className="inline-flex items-center gap-1 rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] font-medium text-white no-underline hover:bg-ink-800">
              {a.more.label} <ChevronRight size={14} aria-hidden="true" />
            </a>
          )}
          {a.suggestions?.map((s) => (
            <Chip key={s} onClick={() => onAsk(s)}>
              {s}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
