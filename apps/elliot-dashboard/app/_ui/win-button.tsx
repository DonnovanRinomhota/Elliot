import { ArrowRight, Inbox, Mail } from "lucide-react";

// The Overview's main button, "Open inbox". Hovering it should feel like a
// small win: the button lifts and glows, a light sweeps across it, a letter
// drops into the inbox, the count pops and gold sparks burst out. All CSS
// (globals.css, .win-btn), and still for people who ask for less motion.
export default function WinButton({ href, count }: { href: string; count: number }) {
  return (
    <a href={href} className="win-btn gold-fill group relative inline-flex h-12 items-center gap-3 rounded-full pl-3 pr-5 text-[14.5px] font-semibold text-navy no-underline shadow-gold">
      <span aria-hidden="true" className="win-sparks">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      <span aria-hidden="true" className="relative flex h-8 w-8 items-center justify-center rounded-full bg-navy/10">
        <Mail size={13} strokeWidth={2.2} className="win-letter absolute" />
        <Inbox size={18} strokeWidth={2} className="win-tray" />
        {count > 0 && (
          <span className="win-count tabular absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-navy px-1 text-[10.5px] font-bold text-white ring-2 ring-[#f3d4a4]">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </span>
      Open inbox
      {count > 0 && <span className="sr-only">, {count} waiting</span>}
      <ArrowRight size={17} aria-hidden="true" className="transition-transform duration-300 group-hover:translate-x-1" />
    </a>
  );
}
