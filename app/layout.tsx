import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Payersight", template: "%s · Payersight" },
  description: "Competitive intelligence on health insurers: products, prices, networks and market moves.",
};

// System font stack via tailwind config — no build-time font fetch, works in air-gapped CI.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
