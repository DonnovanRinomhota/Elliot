import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Same brand palette as Elliot-web (the marketing site), so the
        // dashboard feels like the same product, not a bolted-on admin tool.
        pulse: { DEFAULT: "#22E58F", soft: "#E1FCEE", dark: "#0F6E56" },
        amber: { DEFAULT: "#E7A33E", soft: "#FCF1DF", dark: "#854F0B" },
        coral: { DEFAULT: "#FF6B5B", soft: "#FFEAE6", dark: "#993C1D" },
        ink: "#0D0E17",
      },
    },
  },
  plugins: [],
};

export default config;
