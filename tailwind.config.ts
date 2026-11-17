import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Inter is bundled from npm (@fontsource-variable/inter): no build-time font fetch. System stack as fallback.
        sans: ["Inter Variable", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      // Payersight brand: amber sun #F2A33A, ink #161826.
      colors: { accent: { DEFAULT: "#F2A33A", soft: "#FDF1DF" }, ink: "#161826" },
    },
  },
  plugins: [],
} satisfies Config;
