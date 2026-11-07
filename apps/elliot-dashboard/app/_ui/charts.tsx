// Small charts drawn with SVG (no chart library). Server-safe.

/**
 * Smooth path through points (Catmull-Rom turned into Bézier curves), with
 * the control points kept between their two points' heights so the line
 * never swings above a peak or below the baseline.
 */
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const lo = Math.min(p1[1], p2[1]);
    const hi = Math.max(p1[1], p2[1]);
    const clamp = (y: number) => Math.min(hi, Math.max(lo, y));
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, clamp(p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, clamp(p2[1] - (p3[1] - p1[1]) / 6)];
    d += ` C${c1[0].toFixed(2)},${c1[1].toFixed(2)} ${c2[0].toFixed(2)},${c2[1].toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}

/**
 * Area line chart with a highlighted point and its label (the latest day by
 * default). `tone="onBlue"` draws white on a blue card.
 */
export function AreaLine({
  values,
  labels,
  height = 120,
  tone = "blue",
  highlight,
  label,
  axis,
}: {
  values: number[];
  labels: string[];
  height?: number;
  tone?: "blue" | "onBlue";
  highlight?: number;
  /** Text in the bubble above the highlighted point. */
  label?: string;
  /** Labels under the chart: [first, middle, last]. */
  axis?: [string, string, string];
}) {
  const W = 300;
  const H = height;
  // Room above the highest point for the label bubble.
  const padTop = label ? 38 : 8;
  const padBottom = 4;
  const max = Math.max(1, ...values);
  const n = Math.max(1, values.length - 1);
  const pts: [number, number][] = values.map((v, i) => [(i / n) * W, padTop + (1 - v / max) * (H - padTop - padBottom)]);
  const line = smoothPath(pts);
  const area = `${line} L${W},${H} L0,${H} Z`;
  const hi = highlight ?? values.length - 1;
  const [hx, hy] = pts[hi] ?? [W, H / 2];
  const stroke = tone === "onBlue" ? "#FFFFFF" : "#2563EB";
  const gradId = `g-${tone}-${values.length}-${values.join("-").length}`;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height: H }} role="img" aria-label={labels.map((l, i) => `${l}: ${values[i]}`).join(", ")}>
        <defs>
          <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={tone === "onBlue" ? 0.35 : 0.16} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradId})`} />
        <path d={line} fill="none" stroke={stroke} strokeWidth={2.25} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
        <line x1={hx} x2={hx} y1={hy} y2={H} stroke={stroke} strokeOpacity={0.35} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* The point and its bubble are HTML so they stay round when the SVG stretches. */}
      <span
        aria-hidden="true"
        className={`absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${tone === "onBlue" ? "border-white bg-accent" : "border-accent bg-white"}`}
        style={{ left: `${(hx / W) * 100}%`, top: hy }}
      />
      {label && (
        <span
          className="absolute -translate-y-full whitespace-nowrap rounded-lg bg-white px-2 py-1 text-[11.5px] font-medium text-ink shadow-[0_4px_12px_rgba(16,24,40,0.12)]"
          style={{
            left: `${Math.min(Math.max((hx / W) * 100, 18), 82)}%`,
            top: hy - 10,
            transform: "translate(-50%, -100%)",
          }}
        >
          {label}
        </span>
      )}
      {axis && (
        <div className={`mt-1.5 flex justify-between text-[11.5px] ${tone === "onBlue" ? "text-white/70" : "text-gray-400"}`}>
          <span>{axis[0]}</span>
          <span>{axis[1]}</span>
          <span>{axis[2]}</span>
        </div>
      )}
    </div>
  );
}

/** Half-circle gauge made of coloured segments with gaps, number in the middle. */
export function Gauge({
  segments,
  value,
  caption,
}: {
  segments: { value: number; color: string }[];
  value: string;
  caption: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const R = 80;
  const cx = 100;
  const cy = 96;
  const gap = total > 0 && segments.filter((s) => s.value > 0).length > 1 ? 0.06 : 0;
  let angle = Math.PI; // start on the left
  const arcs = total
    ? segments
        .filter((s) => s.value > 0)
        .map((s) => {
          const sweep = (s.value / total) * Math.PI;
          const a0 = angle + gap / 2;
          const a1 = angle + sweep - gap / 2;
          angle += sweep;
          const p = (a: number) => [cx + R * Math.cos(a), cy + R * Math.sin(a)];
          const [x0, y0] = p(a0);
          const [x1, y1] = p(Math.max(a0, a1));
          return { d: `M${x0},${y0} A${R},${R} 0 0 1 ${x1},${y1}`, color: s.color };
        })
    : [{ d: `M${cx - R},${cy} A${R},${R} 0 0 1 ${cx + R},${cy}`, color: "#E6E9EF" }];
  return (
    <div className="relative mx-auto w-full max-w-[240px]">
      <svg viewBox="0 0 200 110" className="block w-full" aria-hidden="true">
        {arcs.map((a, i) => (
          <path key={i} d={a.d} fill="none" stroke={a.color} strokeWidth={16} strokeLinecap="round" />
        ))}
      </svg>
      <div className="absolute inset-x-0 bottom-1 text-center">
        <div className="tabular text-[34px] font-semibold leading-none tracking-[-0.03em] text-ink">{value}</div>
        <div className="mt-1 text-[12px] text-gray-500">{caption}</div>
      </div>
    </div>
  );
}
