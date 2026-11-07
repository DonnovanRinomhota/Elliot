import type { Config } from "tailwindcss";

// Elliot dashboard palette (light, blue). Each colour has one job:
//   ink     near-black navy: text, primary buttons
//   accent  bright blue: selection, active navigation, charts, highlights
//   gray    cool greys: page background, borders, secondary text
//   brass   amber, "waiting on you": approvals, warm leads, warnings
//   alert   red: escalations, hot leads, destructive actions, errors
// ink-soft is the light blue tint used for hovers, active rows and blue badges.
const ink = { DEFAULT: "#0F172A", 800: "#1E293B", 600: "#475467", 400: "#98A2B3", 200: "#D0D5DD", soft: "#EEF3FE" };
const accent = { DEFAULT: "#2563EB", dark: "#1D4ED8", light: "#60A5FA", soft: "#EEF3FE", 100: "#DCE7FD" };
const brass = { DEFAULT: "#D97706", dark: "#B45309", soft: "#FEF4E4" };
const alert = { DEFAULT: "#DC2626", dark: "#B91C1C", soft: "#FEEFEF" };
const gray = {
  50: "#F8F9FB",
  100: "#F1F3F7",
  200: "#E6E9EF",
  300: "#D5DAE2",
  400: "#98A2B3",
  500: "#667085",
  600: "#475467",
  700: "#344054",
  800: "#1D2939",
  900: "#101828",
};

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"], // includes app/_ui
  theme: {
    extend: {
      colors: {
        ink,
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
        sans: ['"Inter Variable"', "Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.03)",
        lift: "0 12px 32px -12px rgba(16, 24, 40, 0.18)",
      },
    },
  },
  plugins: [],
};

export default config;
