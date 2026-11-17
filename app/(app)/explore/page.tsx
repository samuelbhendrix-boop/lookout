import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { DATASETS, facts, type DatasetKey } from "@/lib/explore";
import { TOPICS, questionQuery } from "@/lib/explore-questions";
import { DataExplorer } from "@/components/DataExplorer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Data explorer" };

export default async function ExplorePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  if (!DATASETS.some((d) => d.key === sp.ds)) redirect(`/explore?${questionQuery(TOPICS[0].questions[0])}`);
  const session = (await getSession())!;
  const ds = sp.ds as DatasetKey;
  const [comps, saved] = await Promise.all([
    db.competitor.findMany({ where: { workspaceId: session.workspaceId }, select: { id: true, name: true, aliases: true, issuerPattern: true } }),
    db.savedPull.findMany({ where: { workspaceId: session.workspaceId }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, query: true } }),
  ]);
  const data = await facts(ds, session.workspaceId, comps);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="h1">Data explorer</h1>
        <p className="max-w-3xl text-sm text-stone-500">Start from a question, then narrow it, reshape it, chart it, save it or export it. Everything the site holds on competitors is here.</p>
      </div>
      <DataExplorer key={JSON.stringify(sp)} facts={data} datasets={DATASETS.map((d) => ({ ...d }))} topics={TOPICS} saved={saved} init={sp} />
    </div>
  );
}
