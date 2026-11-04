import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lookout — competitive signals",
  description: "Track, triage and alert on competitor moves.",
};

// System font stack via tailwind config — no build-time font fetch, works in air-gapped CI.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
