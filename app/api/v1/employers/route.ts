import { route } from "@/lib/api";
import { listEmployers } from "@/lib/marketdata/employers";
import { toCsv } from "@/lib/csv";

/** GET ?state&competitorId&funding&min&q[&format=csv] — employer plans from Form 5500. */
export const GET = route("VIEWER", async ({ session, req }) => {
  const sp = new URL(req.url).searchParams;
  const rows = await listEmployers(session.workspaceId, {
    state: sp.get("state") ?? undefined, competitorId: sp.get("competitorId") ?? undefined, funding: sp.get("funding") ?? undefined,
    q: sp.get("q") ?? undefined, minParticipants: Number(sp.get("min")) || 100, limit: sp.get("format") === "csv" ? 2000 : 300,
  });
  if (sp.get("format") !== "csv") return rows;
  const csv = toCsv(
    ["employer", "ein", "city", "state", "industry", "participants", "plan_year", "funding", "carriers", "persons_covered", "premium", "renewal_months", "brokers", "stop_loss"],
    rows.map((r) => [
      r.sponsor, r.ein, r.city, r.state, r.sector, r.participants, r.planYearBegin.getUTCFullYear(), r.funding,
      [...new Set(r.carriers.map((c) => c.competitorName ?? c.carrier))].join("; "), r.carriers.reduce((s, c) => s + (c.persons ?? 0), 0),
      r.carriers.reduce((s, c) => s + (c.premium ?? 0), 0) || null,
      [...new Set(r.carriers.map((c) => c.renewalMonth).filter(Boolean))].join("; "),
      [...new Set(r.carriers.flatMap((c) => c.brokers))].join("; "), r.stopLoss.join("; "),
    ]),
  );
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="lookout-employers.csv"` } });
});
