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
  const b = await codeBenchmark(codeType, code, billingClass);
  const rows = b.providers.flatMap((p) =>
    Object.values(p.rates).map((r) => {
      const f = b.files.find((x) => x.id === r.fileId)!;
      return { codeType, code, billingClass, carrier: f.carrierName, network: f.network, tin: p.tin, provider: p.name, npiCount: p.npiCount, negotiatedType: r.negotiatedType, median: r.median, min: r.min, max: r.max, fileDate: f.lastUpdated };
    }),
  );
  if (sp.get("format") === "csv") {
    const cols = Object.keys(rows[0] ?? { codeType: 1 }) as Array<keyof (typeof rows)[number]>;
    return new Response(toCsv(cols, rows.map((r) => cols.map((c) => r[c]))), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="rates-${codeType}-${code}-${billingClass}.csv"` },
    });
  }
  const summary = [...b.summary.values()].map((s) => ({ ...s, carrier: b.files.find((f) => f.id === s.fileId)?.carrierName }));
  return Response.json({ data: rows, summary });
}
