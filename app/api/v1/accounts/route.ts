import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { accountsInPlay } from "@/lib/marketdata/inplay";
import { csvCell } from "@/lib/csv";


/** GET /api/v1/accounts?state=&days=&scope=&competitor= — accounts in play as CSV. */
export const GET = route("VIEWER", async ({ session, req }) => {
  const q = new URL(req.url).searchParams;
  const r = await accountsInPlay(session.workspaceId, { state: q.get("state") ?? undefined, days: Number(q.get("days")) || 120, scope: q.get("scope") === "all" ? "all" : "competitors", competitorId: q.get("competitor") ?? undefined });
  const head = ["score", "employer", "city", "state", "sector", "ein", "renewal", "days_out", "filing_year", "carrier", "competitor", "funding", "covered", "premium", "premium_per_person", "claims_to_premium", "brokers", "reasons", "details"];
  const lines = r.rows.map((x) => [x.score, x.sponsor, x.city, x.state, x.sector, x.ein, x.renewal.toISOString().slice(0, 10), x.daysOut, x.filingYear, x.carrier, x.competitorName, x.funding, x.persons ?? x.participants, x.premium && Math.round(x.premium), x.perPerson && Math.round(x.perPerson), x.lossRatio?.toFixed(2), x.brokers.join("; "), x.reasons.map((y) => y.label).join("; "), x.reasons.map((y) => y.detail).join(" | ")].map(csvCell).join(","));
  return new NextResponse([head.join(","), ...lines].join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="accounts-in-play-${new Date().toISOString().slice(0, 10)}.csv"` } });
});
