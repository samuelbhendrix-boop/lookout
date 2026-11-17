import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Payersight", template: "%s · Payersight" },
  description: "Competitive intelligence on health insurers: products, prices, networks and market moves.",
};

// Inter is bundled from npm, so there is no build-time font fetch; the system stack is the fallback.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
