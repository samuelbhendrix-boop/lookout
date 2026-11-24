import { NextResponse } from "next/server";
import { PassThrough, Readable } from "node:stream";
import ExcelJS from "exceljs";
import { getSession } from "@/lib/auth";
import { MRF_TABLES, csvStream, mrfTable, stamp, tableRows } from "@/lib/mrf-export";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

/** One price-file table as CSV, or "all" for every table in one Excel workbook. Streamed, so large tables don't sit in memory. */
export async function GET(_req: Request, { params }: { params: Promise<{ table: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const { table } = await params;
  if (table === "all") {
    const pass = new PassThrough();
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: pass, useStyles: true });
    void (async () => {
      try {
        const info = wb.addWorksheet("Read me");
        info.columns = [{ width: 30 }, { width: 100 }, { width: 90 }];
        info.addRow([`Payersight price-file tables ${stamp()}`]).commit();
        info.addRow(["Tab", "What it holds", "Where it comes from"]).commit();
        for (const t of MRF_TABLES) info.addRow([t.title, t.holds, t.source]).commit();
        info.addRow(["Rates are in US dollars unless the column says percent. Blank means not reported."]).commit();
        info.commit();
        for (const t of MRF_TABLES) {
          const ws = wb.addWorksheet(t.title.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
          ws.columns = t.cols.map((c) => ({ width: Math.max(12, Math.min(44, c.h.length + 4)) }));
          const head = ws.addRow(t.cols.map((c) => c.h)); head.font = { bold: true }; head.commit();
          for await (const r of tableRows(t)) ws.addRow(r).commit();
          ws.commit();
        }
        await wb.commit();
      } catch (e) { pass.destroy(e as Error); }
    })();
    return new Response(Readable.toWeb(pass) as ReadableStream, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="Payersight price-file tables ${stamp()}.xlsx"`, "Cache-Control": "no-store" } });
  }
  const t = mrfTable(table);
  if (!t) return NextResponse.json({ error: "No such table" }, { status: 404 });
  return new Response(csvStream(t), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="Payersight ${t.title.toLowerCase()} ${stamp()}.csv"`, "Cache-Control": "no-store" } });
}
