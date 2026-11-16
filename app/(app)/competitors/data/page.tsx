import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { DATASETS, facts, type DatasetKey } from "@/lib/explore";
import { CompetitorTabs } from "@/components/CompetitorTabs";
import { DataExplorer } from "@/components/DataExplorer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Data table · Competitors" };

export default async function DataPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = (await getSession())!;
  const ds = (DATASETS.find((d) => d.key === sp.ds)?.key ?? "plans") as DatasetKey;
  const [comps, saved] = await Promise.all([
    db.competitor.findMany({ where: { workspaceId: session.workspaceId }, select: { id: true, name: true, aliases: true, issuerPattern: true } }),
    db.savedPull.findMany({ where: { workspaceId: session.workspaceId }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, query: true } }),
  ]);
  const data = await facts(ds, session.workspaceId, comps);
  return (
    <div className="space-y-4">
      <CompetitorTabs view="data" sub="A pivot table over everything the site holds: pick a dataset, put any fields on rows and columns, choose values and how they're summarized, filter on anything, then chart, save or export." />
      <DataExplorer key={ds} facts={data} datasets={DATASETS.map((d) => ({ ...d }))} saved={saved} init={{ ...sp, ds: sp.ds ?? ds }} />
    </div>
  );
}
