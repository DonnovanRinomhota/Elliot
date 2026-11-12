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
 * A small line with a soft fill under it, for the Overview's figures. The
 * last point is marked. `id` must be unique on the page (it names the fill).
 */
export function Sparkline({
  values,
  id,
  color = "#D9A56C",
  width = 112,
  height = 38,
  label,
}: {
  values: number[];
  id: string;
  color?: string;
  width?: number;
  height?: number;
  /** What the line shows, for screen readers. */
  label: string;
}) {
  const max = Math.max(1, ...values);
  const n = Math.max(1, values.length - 1);
  const pad = 4;
  const pts: [number, number][] = values.map((v, i) => [(i / n) * width, pad + (1 - v / max) * (height - pad * 2)]);
  const line = smoothPath(pts);
  const [lx, ly] = pts[pts.length - 1] ?? [width, height / 2];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="block flex-shrink-0 overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.32} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${line} L${width},${height} L0,${height} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r={3.2} fill="#fff" stroke={color} strokeWidth={2} />
    </svg>
  );
}
