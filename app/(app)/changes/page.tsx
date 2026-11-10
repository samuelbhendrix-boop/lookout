import { redirect } from "next/navigation";

const CAT: Record<string, string> = { account_won: "sales", account_lost: "sales", rate_filing: "pricing", rate_change: "pricing", network_add: "network", network_drop: "network" };

export default async function Changes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = new URLSearchParams({ view: "market", days: "365" });
  if (sp.kind && CAT[sp.kind]) p.set("cat", CAT[sp.kind]);
  if (sp.state) p.set("state", sp.state);
  if (sp.competitor) p.set("competitorId", sp.competitor);
  if (sp.carrier) p.set("q", sp.carrier);
  redirect(`/updates?${p}`);
}
