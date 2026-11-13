// Elliot logo (drawn from the brand logo, November 2026): the gold house
// whose inner lines form an E, and the ELLIOT wordmark (Jost, as outlines,
// so no font is needed). Generated from the brand kit; the files live in
// brand/ at the repo root.

const GOLD = ["#F3D4A4", "#D9A56C", "#B97E47", "#E2B47E"];

/**
 * The gold gradient every mark uses, defined once at the top of the page
 * (app/layout.tsx). A gradient defined inside a hidden element (the desktop
 * sidebar on a phone) doesn't paint, so it lives in its own tiny SVG that is
 * always rendered.
 */
export function ElliotGoldDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      <defs>
        <linearGradient id="elliot-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={GOLD[0]} />
          <stop offset="0.38" stopColor={GOLD[1]} />
          <stop offset="0.72" stopColor={GOLD[2]} />
          <stop offset="1" stopColor={GOLD[3]} />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** The house-E mark. `tone`: gold (default), or a flat colour for one-colour use. */
export function ElliotMark({ size = 28, tone = "gold", className = "" }: { size?: number; tone?: "gold" | string; className?: string }) {
  const fill = tone === "gold" ? "url(#elliot-gold)" : tone;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className={className} fill={fill}>
      <path d="M0 100 V24 L47 0 L100 30 V40.5 L47 14.5 L17.5 29.5 V100 Z" />
      <path d="M56 100 V35 L56 34.6 L100 54 V64 L71.5 51.5 V100 Z" />
      <path d="M74 86 H100 V100 H74 Z" />
    </svg>
  );
}

/** The ELLIOT wordmark in the current text colour (or `color`). Height = cap height. */
export function ElliotWordmark({ height = 14, color = "currentColor", className = "" }: { height?: number; color?: string; className?: string }) {
  const w = (545.00 / 70.00) * height;
  return (
    <svg width={w} height={height} viewBox="0 -70.00 545.00 70.00" aria-hidden="true" className={className} fill={color}>
      <path transform="translate(0.00 0) scale(0.10000 -0.10000)" d="M80 700V0H480V80H165V340H460V420H165V620H480V700Z" /><path transform="translate(105.00 0) scale(0.10000 -0.10000)" d="M80 700V0H440V80H165V700Z" /><path transform="translate(200.00 0) scale(0.10000 -0.10000)" d="M80 700V0H440V80H165V700Z" /><path transform="translate(295.00 0) scale(0.10000 -0.10000)" d="M80 700V0H165V700Z" /><path transform="translate(369.50 0) scale(0.10000 -0.10000)" d="M130 350Q130 429 164.5 491.0Q199 553 259.0 589.0Q319 625 395 625Q472 625 531.5 589.0Q591 553 625.5 491.0Q660 429 660 350Q660 271 625.5 209.0Q591 147 531.5 111.0Q472 75 395 75Q319 75 259.0 111.0Q199 147 164.5 209.0Q130 271 130 350ZM40 350Q40 274 66.5 208.0Q93 142 141.0 93.5Q189 45 254.0 17.5Q319 -10 395 -10Q472 -10 536.5 17.5Q601 45 649.0 93.5Q697 142 723.5 208.0Q750 274 750 350Q750 427 723.5 492.5Q697 558 649.0 606.5Q601 655 536.5 682.5Q472 710 395 710Q319 710 254.0 682.5Q189 655 141.0 606.5Q93 558 66.5 492.5Q40 427 40 350Z" /><path transform="translate(498.50 0) scale(0.10000 -0.10000)" d="M10 620H190V0H275V620H455V700H10Z" />
    </svg>
  );
}

/** Mark + wordmark side by side, labelled "Elliot" for screen readers. */
// Same as the website's navbar: the gold mark, and the wordmark in pale gold.
export function ElliotLogo({ size = 34, color = "#EBCB9E", tone = "gold", className = "" }: { size?: number; color?: string; tone?: "gold" | string; className?: string }) {
  return (
    <span role="img" aria-label="Elliot" className={`inline-flex items-center ${className}`} style={{ gap: size * 0.41 }}>
      <ElliotMark size={size} tone={tone} />
      <ElliotWordmark height={size * 0.41} color={color} />
    </span>
  );
}
