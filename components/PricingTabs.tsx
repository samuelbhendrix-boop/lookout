import Link from "next/link";

/**
 * Header for the Prices page: one page, two views over the same rate files. The state carries across views
 * ("all" exists only on Compare hospitals, so the explorer falls back to MA).
 */
export function PricingTabs({ view, state, children }: { view: "compare" | "explore"; state?: string; children?: React.ReactNode }) {
  const st = state && state !== "all" ? state : undefined;
  const tab = (on: boolean) => `-mb-px border-b-2 px-3 py-2 text-sm ${on ? "border-stone-900 font-medium text-stone-900" : "border-transparent text-stone-500 hover:text-stone-900"}`;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">Prices</h1>
          <p className="text-sm text-stone-500">What each carrier pays providers, from their federally required rate files. <Link href="/leverage" className="underline">Leverage</Link> has the summary; <Link href="/networks" className="underline">Networks</Link> has who&apos;s in each network.</p>
        </div>
        {children}
      </div>
      <nav className="flex gap-1 border-b border-stone-200">
        <Link href={`/rates${state ? `?state=${state}` : ""}`} className={tab(view === "compare")}>Compare hospitals</Link>
        <Link href={`/rates/explore${st ? `?state=${st}` : ""}`} className={tab(view === "explore")}>Explore a code</Link>
      </nav>
    </div>
  );
}
