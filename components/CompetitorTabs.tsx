/** Page header for the Competitors section. The sidebar switches between Overview, Strategy, Products and Website changes. */
export function CompetitorTabs({ view, sub, children }: { view: "overview" | "products" | "strategy" | "changes"; sub: string; children?: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">{view === "products" ? "Competitor products" : view === "changes" ? "Website changes" : view === "strategy" ? "Competitor strategy" : "Competitors"}</h1>
          <p className="max-w-3xl text-sm text-stone-500">{sub}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
