import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { LEVELS, MARKETED, NE, pull, type Level } from "@/lib/explore";
import { CompetitorTabs } from "@/components/CompetitorTabs";
import { DataExplorer } from "@/components/DataExplorer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Data table · Competitors" };

const list = (v: string | undefined, sep = "|") => (v ? v.split(sep).map((x) => x.trim()).filter(Boolean) : []);

export default async function DataPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = (await getSession())!;
  const level = (LEVELS.find((l) => l.key === sp.level)?.key ?? "plan") as Level;
  const [comps, maxPlan, minFin, saved] = await Promise.all([
    db.competitor.findMany({ where: { workspaceId: session.workspaceId }, select: { id: true, name: true, aliases: true, issuerPattern: true } }),
    db.ratePlan.aggregate({ _max: { planYear: true } }),
    db.marketFinancial.aggregate({ _min: { year: true } }),
    db.savedPull.findMany({ where: { workspaceId: session.workspaceId }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, query: true } }),
  ]);
  const maxY = maxPlan._max.planYear ?? new Date().getFullYear() + 1;
  const minY = level === "carrier" ? minFin._min.year ?? maxY - 7 : maxY - 3;
  const states = list(sp.st, ",").map((s) => s.toUpperCase()).filter((s) => NE.includes(s));
  const clamp = (v: string | undefined, d: number) => { const n = Number(v); return Number.isInteger(n) && n >= minY && n <= maxY ? n : d; };
  const to = clamp(sp.to, maxY), from = Math.min(to, clamp(sp.from, level === "carrier" ? Math.max(minY, maxY - 5) : maxY - 1));
  const view = { level, states: states.length ? states : level === "plan" ? ["MA"] : NE, from, to, carriers: list(sp.c), segments: list(sp.seg), networks: list(sp.net), metals: list(sp.metal), marketed: list(sp.mk).filter((k) => MARKETED.some((m) => m.key === k)) };
  const data = await pull(level, view, comps);
  return (
    <div className="space-y-4">
      <CompetitorTabs view="data" sub="Build your own table from everything the site holds on competitors' products: pick what a row is, filter, choose columns, chart a trend, then save or export the pull." />
      <DataExplorer key={level} pull={data} view={view} levels={LEVELS.map((l) => ({ ...l }))} allStates={NE} yearRange={[minY, maxY]} marketedOptions={MARKETED} saved={saved} init={{ cols: sp.cols, sort: sp.sort, q: sp.q, chart: sp.chart, by: sp.by }} />
    </div>
  );
}
