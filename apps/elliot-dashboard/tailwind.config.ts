import type { Config } from "tailwindcss";

// Elliot dashboard palette: the same look as getelliot.eu (navy, gold and
// pale sky). Each colour has one job:
//   ink     deep navy: text, the sidebar, dark panels
//   gold    the brand gold: primary buttons, the active page, highlights
//   accent  sky blue: selection, links, charts
//   gray    cool blue-greys: page background, borders, secondary text
//   brass   darker gold for text, "waiting on you": approvals, warm leads, warnings
//   alert   red: escalations, hot leads, destructive actions, errors
// ink-soft is the pale tint used for hovers, active rows and blue badges.
const ink = { DEFAULT: "#0F1F38", 800: "#14325C", 600: "#4E5F7A", 400: "#97A6BC", 200: "#D6DEEA", soft: "#EEF2F8" };
const gold = { DEFAULT: "#D9A56C", light: "#F3D4A4", deep: "#B97E47", soft: "#F7ECDD" };
const accent = { DEFAULT: "#2B5590", dark: "#14325C", light: "#6F95D1", soft: "#EAF0F9", 100: "#D5E1F2" };
const brass = { DEFAULT: "#B97E47", dark: "#8A5A2B", soft: "#F7ECDD" };
const alert = { DEFAULT: "#C9372C", dark: "#A92E25", soft: "#FDEEEC" };
const gray = {
  50: "#F6F8FC",
  100: "#EEF2F8",
  200: "#E3E9F2",
  300: "#D2DBE8",
  // 400 is for hints and placeholders; still readable on white.
  400: "#76859E",
  500: "#56678A",
  600: "#4E5F7A",
  700: "#34445E",
  800: "#1D2B44",
  900: "#0F1F38",
};

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"], // includes app/_ui
  theme: {
    extend: {
      colors: {
        ink,
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
        card: "0 1px 2px rgba(15, 31, 56, 0.04), 0 22px 44px -34px rgba(15, 40, 80, 0.35)",
        lift: "0 18px 40px -16px rgba(15, 40, 80, 0.3)",
        gold: "0 10px 22px -12px rgba(185, 126, 71, 0.9)",
      },
    },
  },
  plugins: [],
};

export default config;
