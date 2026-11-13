// Shown the moment you open another page, while its data loads: the shape of
// a page (title, tabs, a few rows) shimmering on the glass, so switching
// feels instant.
export default function PageSkeleton() {
  const bar = "skeleton rounded-full";
  return (
    <div aria-busy="true" aria-live="polite" className="pt-1 md:pt-2">
      <span className="sr-only">Loading…</span>
      <div className={`${bar} mb-4 h-3 w-28`} />
      <div className={`${bar} h-9 w-64`} />
      <div className={`${bar} mt-3 h-4 w-[min(520px,80%)]`} />
      <div className="mt-6 flex gap-2">
        {[64, 92, 80, 110].map((w) => (
          <div key={w} className={`${bar} h-9`} style={{ width: w }} />
        ))}
      </div>
      <div className="card mt-6 grid gap-2 p-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-glass px-3.5 py-3">
            <div className="skeleton h-9 w-9 flex-shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <div className={`${bar} h-3.5`} style={{ width: `${38 + ((i * 17) % 30)}%` }} />
              <div className={`${bar} mt-2 h-3`} style={{ width: `${55 + ((i * 11) % 30)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
