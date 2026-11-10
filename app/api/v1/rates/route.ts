import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { codeBenchmark } from "@/lib/marketdata/mrf/queries";
import { toCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

/** GET /api/v1/rates?code=APR-DRG|302&class=institutional[&format=csv] — provider × carrier negotiated rates for one service. */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const [codeType, code] = (sp.get("code") ?? "APR-DRG|302").split("|");
  const billingClass = sp.get("class") === "professional" ? "professional" : "institutional";
  if (!codeType || !code || !/^[\w-]{1,10}$/.test(code)) return Response.json({ error: { message: "code must look like CPT|99213" } }, { status: 422 });
  const state = sp.get("state") ?? "all";
  const b = await codeBenchmark(codeType, code, billingClass, state, sp.getAll("net"));
  const rows = b.providers.flatMap((p) =>
    Object.entries(p.rates).flatMap(([carrier, r]) =>
      r.networks.map((n) => {
        const mc = p.medicare;
        return {
          codeType, code, billingClass, carrier: b.carriers.find((c) => c.carrier === carrier)?.carrierName ?? carrier, network: n.network, state: p.state, tin: p.tin, provider: p.name, npiCount: p.npiCount,
          negotiatedType: n.type, rate: n.median, carrierMedian: r.median,
          medicare: mc.amount, pctOfMedicare: mc.amount ? Math.round((n.median / mc.amount) * 1000) / 10 : null,
          medicareMethod: mc.amount ? mc.method : (mc as { reason: string }).reason,
        };
      }),
    ),
  );
  if (sp.get("format") === "csv") {
    const cols = Object.keys(rows[0] ?? { codeType: 1 }) as Array<keyof (typeof rows)[number]>;
    return new Response(toCsv(cols, rows.map((r) => cols.map((c) => r[c]))), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="rates-${codeType}-${code}-${billingClass}-${state}.csv"` },
    });
  }
  return Response.json({ data: rows, carriers: b.carriers.map((c) => ({ carrier: c.carrierName, networks: c.networks, summary: c.summary })) });
}
