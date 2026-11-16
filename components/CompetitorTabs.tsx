import Link from "next/link";

/** Header for the Competitors section: who they are, what they sell, and a build-your-own table over all of it. */
export function CompetitorTabs({ view, sub, children }: { view: "overview" | "products" | "data"; sub: string; children?: React.ReactNode }) {
  const tab = (on: boolean) => `-mb-px border-b-2 px-3 py-2 text-sm ${on ? "border-stone-900 font-medium text-stone-900" : "border-transparent text-stone-500 hover:text-stone-900"}`;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">Competitors</h1>
          <p className="max-w-3xl text-sm text-stone-500">{sub}</p>
        </div>
        {children}
      </div>
      <nav className="flex gap-1 border-b border-stone-200">
        <Link href="/competitors" className={tab(view === "overview")}>Overview</Link>
        <Link href="/competitors/products" className={tab(view === "products")}>Products</Link>
        <Link href="/competitors/data" className={tab(view === "data")}>Data table</Link>
      </nav>
    </div>
  );
}
