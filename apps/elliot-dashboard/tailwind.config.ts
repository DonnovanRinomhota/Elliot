import type { Config } from "tailwindcss";

// Elliot dashboard palette: frosted glass over the website's blue sky. The
// page is dark, so text is light and surfaces are translucent. Each colour
// has one job:
//   ink     the text colour (near white) and its softer steps
//   navy    solid dark fills and text on gold or white (buttons, chosen chips)
//   glass   translucent white surfaces: rows, fields, secondary buttons
//   gold    the brand gold: primary buttons, the active page, highlights
//   accent  light sky blue: selection, links, charts
//   gray    white at different strengths: borders, quiet surfaces, secondary text
//   brass   light gold text and tinted pills, "waiting on you"
//   alert   coral text and tinted pills: escalations, hot leads, errors
// The -soft colours are see-through tints, so pills sit on glass.
const ink = { DEFAULT: "#F4F7FC", 800: "#FFFFFF", 600: "rgba(255,255,255,0.8)", 400: "rgba(255,255,255,0.56)", 200: "rgba(255,255,255,0.2)", soft: "rgba(255,255,255,0.09)" };
const navy = { DEFAULT: "#0B1E40", 800: "#13305C" };
const glass = { DEFAULT: "rgba(255,255,255,0.075)", hi: "rgba(255,255,255,0.14)", lo: "rgba(255,255,255,0.04)" };
const gold = { DEFAULT: "#D9A56C", light: "#F3D4A4", deep: "#B97E47", soft: "rgba(217,165,108,0.16)" };
const accent = { DEFAULT: "#A9C6F5", dark: "#D6E5FC", light: "#6F95D1", soft: "rgba(125,165,235,0.22)", 100: "rgba(125,165,235,0.34)" };
const brass = { DEFAULT: "#E8C08E", dark: "#F3D4A4", soft: "rgba(217,165,108,0.18)" };
const alert = { DEFAULT: "#FFA097", dark: "#FFBDB6", soft: "rgba(240,113,103,0.2)" };
const gray = {
  50: "rgba(255,255,255,0.04)",
  100: "rgba(255,255,255,0.08)",
  200: "rgba(255,255,255,0.14)",
  300: "rgba(255,255,255,0.24)",
  // 400 is for hints and placeholders.
  400: "rgba(255,255,255,0.56)",
  500: "rgba(255,255,255,0.7)",
  600: "rgba(255,255,255,0.78)",
  700: "rgba(255,255,255,0.87)",
  800: "rgba(255,255,255,0.94)",
  900: "#FFFFFF",
};

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"], // includes app/_ui
  theme: {
    extend: {
      colors: {
        ink,
        navy,
        glass,
        gold,
        accent,
        brass,
        alert,
        gray,
        // Legacy names from the first dashboard design, mapped onto the
        // palette so any leftover class still lands on a palette colour.
        pulse: { DEFAULT: accent.DEFAULT, soft: accent.soft, dark: accent.dark },
        amber: { DEFAULT: brass.DEFAULT, soft: brass.soft, dark: brass.dark },
        coral: { DEFAULT: alert.DEFAULT, soft: alert.soft, dark: alert.dark },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans Variable"', '"Plus Jakarta Sans"', "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 0 rgba(255, 255, 255, 0.08) inset, 0 24px 48px -30px rgba(2, 12, 32, 0.7)",
        lift: "0 1px 0 rgba(255, 255, 255, 0.12) inset, 0 26px 54px -24px rgba(2, 12, 32, 0.85)",
        gold: "0 10px 22px -12px rgba(185, 126, 71, 0.9)",
      },
    },
  },
  plugins: [],
};

export default config;
