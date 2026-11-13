import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b0f14",
        panel: "#121821",
        line: "#243041",
        mist: "#9db0c7",
        foam: "#e8eef5",
        accent: "#3ddc97",
        warn: "#f0b429",
        danger: "#ff6b6b",
      },
      fontFamily: {
        display: ["\"Space Grotesk\"", "system-ui", "sans-serif"],
        body: ["\"IBM Plex Sans\"", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
