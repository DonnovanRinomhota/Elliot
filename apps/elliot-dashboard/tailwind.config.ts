import type { Config } from "tailwindcss";

// Elliot dashboard palette -- four colours, each with one job:
//   ink    navy: text, primary actions, active navigation, charts
//   gray   cool greys: backgrounds, borders, secondary text (Tailwind's own scale)
//   brass  "waiting on you": pending approvals, warm leads, highlights
//   alert  signal red: escalations, hot leads, destructive actions, errors
// Nothing else. Success states use ink, not green.
const ink = { DEFAULT: "#13223A", 800: "#1C2F4D", 600: "#3B4D6B", 400: "#7D8BA3", 200: "#C9D1DE", soft: "#EDF0F5" };
const brass = { DEFAULT: "#9A7328", dark: "#7A5A1C", soft: "#F6EFE1" };
const alert = { DEFAULT: "#B42318", dark: "#912018", soft: "#FCEDEB" };

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"], // includes app/_ui
  theme: {
    extend: {
      colors: {
        ink,
        brass,
        alert,
        // Legacy names from the first dashboard design, mapped onto the new
        // palette so any leftover class still lands on a palette colour.
        pulse: { DEFAULT: ink.DEFAULT, soft: ink.soft, dark: ink.DEFAULT },
        amber: { DEFAULT: brass.DEFAULT, soft: brass.soft, dark: brass.dark },
        coral: { DEFAULT: alert.DEFAULT, soft: alert.soft, dark: alert.dark },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
