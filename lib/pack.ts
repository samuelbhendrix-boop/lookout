import ExcelJS from "exceljs";
import { createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";
import { decode, facts } from "@/lib/explore";
import { SITES } from "@/lib/marketing/sites";

/**
 * The monthly pack: the site's headline tables as one Excel workbook, built for an assistant (Microsoft 365 Copilot
 * and the like) that can't sign in here. Every tab is a plain Excel table with one header row; "Read me" says what each
 * tab holds and where it comes from, and "Brief" puts the month's main changes in sentences. Built on demand, so it is
 * always current. Each pull is named with the day it was made (Eastern time), so copies sit side by side in date order.
 */
export const PACK_NAME = "Payersight monthly pack";
/** Today in Eastern time, as YYYY-MM-DD: the date stamped on the file name and the Read me tab. */
export const packDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
export const packFilename = () => `${PACK_NAME} ${packDate()}.xlsx`;
const WINDOW_DAYS = 35; // "this month", with a few days' overlap so nothing falls between two pulls

type Cell = string | number | Date | null;
type Col = { h: string; fmt?: "int" | "usd" | "pct" | "date"; w?: number };
type Tab = { name: string; holds: string; source: string; cols: Col[]; rows: Cell[][] };
const FMT = { int: "#,##0", usd: "$#,##0", pct: "0.0%", date: "yyyy-mm-dd" } as const;
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const div = (a: unknown, b: unknown, mult = 1) => (n(a) != null && n(b) ? (n(a)! / n(b)!) * mult : null);
const pos = (v: number | null) => (v ? v : null); // a zero premium means none was reported (an administration-only contract), not a free plan
const uniq = (xs: Array<string | number | null | undefined>) => [...new Set(xs.filter((x): x is string | number => x != null && x !== "").map(String))].sort().join("; ") || null;
const KIND: Record<string, string> = { account_won: "Account won", account_lost: "Account lost", rate_filing: "Rate filing", rate_change: "Rate change", network_add: "Network addition", network_drop: "Network drop" };
const kind = (k: string) => KIND[k] ?? k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const IMPACT: Record<number, string> = { 3: "High", 2: "Notable", 1: "Background" };

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

export async function buildPack(workspaceId: string): Promise<{ buffer: Buffer; brief: string[] }> {
  const since = new Date(Date.now() - WINDOW_DAYS * 864e5);
  const [ws, comps, filings, news, events, reworded] = await Promise.all([
    db.workspace.findUnique({ where: { id: workspaceId }, select: { name: true, ownCompetitorId: true } }),
    db.competitor.findMany({ where: { workspaceId }, select: { id: true, name: true, aliases: true, issuerPattern: true } }),
    db.serffFiling.findMany({ orderBy: [{ submitted: "desc" }, { createdAt: "desc" }], select: { tracking: true, state: true, company: true, market: true, planYear: true, filingType: true, disposition: true, submitted: true, newProduct: true, detail: true, createdAt: true } }),
    db.aiNews.findMany({ where: { relevant: true, publishedAt: { gte: since } }, orderBy: [{ impact: "desc" }, { publishedAt: "desc" }], take: 300, select: { title: true, outlet: true, category: true, impact: true, why: true, url: true, publishedAt: true } }),
    db.marketEvent.findMany({ where: { occurredAt: { gte: since } }, orderBy: [{ importance: "desc" }, { occurredAt: "desc" }], take: 1000, select: { kind: true, carrier: true, state: true, title: true, summary: true, importance: true, occurredAt: true } }),
    db.productPageVersion.findMany({ where: { replacedAt: { gte: since } }, orderBy: { replacedAt: "desc" }, take: 300, select: { site: true, url: true, title: true, kind: true, replacedAt: true, added: true, removed: true } }),
  ]);
  const us = comps.find((c) => c.id === ws?.ownCompetitorId)?.name ?? null;
  const isUs = (c: unknown) => (us ? (c === us ? "Yes" : "No") : null);
  const [ovF, plF, mkF] = await Promise.all([facts("overview", workspaceId, comps), facts("plans", workspaceId, comps), facts("marketed", workspaceId, comps)]);
  const ov = decode(ovF);
  const by = (a: Cell[], b: Cell[], keys: number[]) => { for (const k of keys) { const x = a[Math.abs(k)], y = b[Math.abs(k)]; const c = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? "")); if (c) return k < 0 ? -c : c; } return 0; };

  // 1. Every carrier, latest year of each source.
  const latest = ov.filter((o) => o.period === "Latest available").map((o): Cell[] => [o.state, o.segment, o.carrier, isUs(o.carrier), n(o.lives), div(o.premium, o.mm), div(o.claims, o.premium), n(o.sf), n(o.emps), pos(div(o.empPrem, o.empPersons, 1 / 12)), n(o.plans), n(o.planMembers), div(o.rateX, o.rateW)])
    .sort((a, b) => by(a, b, [0, 1, -4, 2]));

  // 2. Fully insured members, share, price and loss ratio by year.
  const yearly = ov.filter((o) => o.period === "Each year" && n(o.lives) != null);
  const tot = new Map<string, number>();
  for (const o of yearly) { const k = `${o.state}|${o.segment}|${o.year}`; tot.set(k, (tot.get(k) ?? 0) + n(o.lives)!); }
  const trend = yearly.map((o): Cell[] => [o.state, o.segment, Number(o.year), o.carrier, isUs(o.carrier), n(o.lives), div(o.lives, tot.get(`${o.state}|${o.segment}|${o.year}`)), div(o.premium, o.mm), div(o.claims, o.premium)])
    .sort((a, b) => by(a, b, [0, 1, 2, -5]));

  // 3. Filed individual and small group plans, by carrier and plan year.
  type G = { k: Cell[]; plans: number; members: number; hasM: boolean; p40: number; p40n: number; rw: number; rx: number; fresh: number };
  const g = new Map<string, G>();
  for (const o of decode(plF)) {
    if (!o.carrier || !o.segment || o.term === 1) continue;
    const key = `${o.state}|${o.segment}|${o.year}|${o.carrier}`;
    const r = g.get(key) ?? g.set(key, { k: [o.state, o.segment, Number(o.year), o.carrier, isUs(o.carrier)], plans: 0, members: 0, hasM: false, p40: 0, p40n: 0, rw: 0, rx: 0, fresh: 0 }).get(key)!;
    r.plans++; r.fresh += n(o.isNew) ?? 0;
    if (n(o.members) != null) { r.members += n(o.members)!; r.hasM = true; }
    if (n(o.prem40) != null) { r.p40 += n(o.prem40)!; r.p40n++; }
    if (n(o.rate) != null) { const w = n(o.members) || 1; r.rw += w; r.rx += n(o.rate)! * w; }
  }
  const filed = [...g.values()].map((r): Cell[] => [...r.k, r.plans, r.fresh, r.hasM ? r.members : null, r.p40n ? r.p40 / r.p40n : null, r.rw ? r.rx / r.rw : null]).sort((a, b) => by(a, b, [0, 1, 2, -5]));

  // 4. Large group employer accounts (Form 5500).
  const employers = ov.filter((o) => o.period === "Each year" && n(o.emps) != null).map((o): Cell[] => [o.state, Number(o.year), o.carrier, isUs(o.carrier), n(o.emps), n(o.empPersons), pos(div(o.empPrem, o.empPersons, 1 / 12))]).sort((a, b) => by(a, b, [0, 1, -4]));

  // 5. Products as marketed on carriers' websites: one row per product.
  const mk = new Map<string, Array<Record<string, string | number | null>>>();
  for (const o of decode(mkF)) { const k = `${o.carrier}|${o.product}`; (mk.get(k) ?? mk.set(k, []).get(k)!).push(o); }
  const marketed = [...mk.values()].map((xs): Cell[] => [xs[0].carrier, isUs(xs[0].carrier), xs[0].product, xs[0].family, uniq(xs.map((x) => x.segment)), uniq(xs.map((x) => x.state)), xs[0].ptype, xs[0].network, uniq(xs.map((x) => x.funding)), xs[0].buyer, uniq(xs.map((x) => x.partner))]).sort((a, b) => by(a, b, [0, 2]));

  // 6–8. State filings, AI watch, market changes.
  const det = (d: unknown) => (d ?? {}) as { headline?: string; points?: string[] };
  const filingRows = filings.map((f): Cell[] => [f.tracking, f.state, f.company, f.market, f.planYear, f.filingType, f.disposition, f.submitted, f.newProduct ? "Yes" : "No", det(f.detail).headline ?? null, det(f.detail).points?.join(" | ") ?? null]);
  const newsRows = news.map((x): Cell[] => [x.publishedAt, x.title, x.outlet, x.category, x.impact ? IMPACT[x.impact] ?? null : null, x.why, x.url]);
  const eventRows = events.map((e): Cell[] => [e.occurredAt, kind(e.kind), e.carrier, e.state, e.title, e.summary, e.importance]);

  const strs = (j: unknown) => (Array.isArray(j) ? j.filter((x): x is string => typeof x === "string") : []);
  const rewordedRows = reworded.map((v): Cell[] => [v.replacedAt, SITES.find((x) => x.key === v.site)?.label ?? v.site, v.title, v.kind === "pdf" ? "Document" : "Web page", strs(v.added).slice(0, 12).join(" | ").slice(0, 6000) || null, strs(v.removed).slice(0, 12).join(" | ").slice(0, 6000) || null, v.url]);

  const tabs: Tab[] = [
    { name: "Carrier overview", holds: "Every carrier on one row per state and segment, with the latest figure from each source side by side.", source: ovF.notes[0],
      cols: [{ h: "State", w: 8 }, { h: "Segment", w: 14 }, { h: "Carrier", w: 36 }, { h: "Is us", w: 8 }, { h: "Fully insured members", fmt: "int" }, { h: "Premium per member per month", fmt: "usd" }, { h: "Loss ratio", fmt: "pct" }, { h: "Self-funded members", fmt: "int" }, { h: "Employer accounts", fmt: "int" }, { h: "Employer premium per person per month", fmt: "usd" }, { h: "Plans filed", fmt: "int" }, { h: "Members in filed plans", fmt: "int" }, { h: "Filed rate change", fmt: "pct" }], rows: latest },
    { name: "Members and price by year", holds: "Fully insured members, share of the carriers listed, premium and loss ratio for each carrier, state, segment and year. Use it for share and growth trends, including large group.", source: "CMS medical loss-ratio filings (through 2024), plus Maine's state large group report for later years. Share is each carrier's members divided by the total of the carriers in this tab for that state, segment and year.",
      cols: [{ h: "State", w: 8 }, { h: "Segment", w: 14 }, { h: "Year", w: 8 }, { h: "Carrier", w: 36 }, { h: "Is us", w: 8 }, { h: "Fully insured members", fmt: "int" }, { h: "Share of members", fmt: "pct" }, { h: "Premium per member per month", fmt: "usd" }, { h: "Loss ratio", fmt: "pct" }], rows: trend },
    { name: "Filed plans", holds: "Individual and small group plans each carrier filed, by plan year: how many, how many are new, members, average premium at age 40 and the filed rate change. Large group plans are not filed publicly, so they are not here.", source: plF.notes[0],
      cols: [{ h: "State", w: 8 }, { h: "Segment", w: 14 }, { h: "Plan year", w: 10 }, { h: "Carrier", w: 36 }, { h: "Is us", w: 8 }, { h: "Plans", fmt: "int" }, { h: "New plans", fmt: "int" }, { h: "Members", fmt: "int" }, { h: "Average premium at age 40", fmt: "usd" }, { h: "Filed rate change", fmt: "pct" }], rows: filed },
    { name: "Employer accounts", holds: "Large group employer accounts each carrier holds, covered persons and premium per person, by state and plan year.", source: "US Department of Labor Form 5500 filings, mostly plans with 100 or more participants. Filings arrive 7 to 10 months after a plan year ends, so the newest year is incomplete.",
      cols: [{ h: "State", w: 8 }, { h: "Plan year", w: 10 }, { h: "Carrier", w: 36 }, { h: "Is us", w: 8 }, { h: "Employer accounts", fmt: "int" }, { h: "Covered persons", fmt: "int" }, { h: "Premium per person per month", fmt: "usd" }], rows: employers },
    { name: "Marketed products", holds: "The products each carrier markets now, including large group and self-funded: segments, states, plan type, network model, funding and named partners. No premiums or enrollment.", source: mkF.notes[0],
      cols: [{ h: "Carrier", w: 36 }, { h: "Is us", w: 8 }, { h: "Product", w: 40 }, { h: "Product family", w: 24 }, { h: "Segments", w: 30 }, { h: "States", w: 16 }, { h: "Plan type", w: 12 }, { h: "Network model", w: 14 }, { h: "Funding", w: 24 }, { h: "Aimed at", w: 30 }, { h: "Vendors and partners", w: 40 }], rows: marketed },
    { name: "State filings", holds: "Carrier filings with state regulators that have been loaded into Payersight, each with a one-line takeaway and its key points.", source: "SERFF filings uploaded on the State filings page. Coverage is only what has been uploaded, not every filing in the market.",
      cols: [{ h: "Tracking number", w: 22 }, { h: "State", w: 8 }, { h: "Company", w: 40 }, { h: "Market", w: 14 }, { h: "Plan year", w: 10 }, { h: "Filing type", w: 30 }, { h: "Status", w: 24 }, { h: "Submitted", fmt: "date" }, { h: "New product", w: 12 }, { h: "Takeaway", w: 80 }, { h: "Key points", w: 120 }], rows: filingRows },
    { name: "AI watch", holds: `AI industry news from the last ${WINDOW_DAYS} days that matters to health insurers, with why it matters.`, source: "News searches read and tagged by AI. Impact: High changes payer economics, operations or compliance; Notable is worth knowing; Background is context.",
      cols: [{ h: "Published", fmt: "date" }, { h: "Headline", w: 80 }, { h: "Outlet", w: 24 }, { h: "Category", w: 26 }, { h: "Impact", w: 12 }, { h: "Why it matters", w: 100 }, { h: "Link", w: 50 }], rows: newsRows },
    { name: "Changes this month", holds: `Market changes Payersight detected in the last ${WINDOW_DAYS} days: accounts won and lost, rate filings, negotiated-rate changes and network changes.`, source: "Detected by comparing each month's filings and price files with the month before. A higher importance number means a bigger change. Rate filings are dated by the day the new rates take effect, so some dates are in the future.",
      cols: [{ h: "Date", fmt: "date" }, { h: "Type", w: 18 }, { h: "Carrier", w: 36 }, { h: "State", w: 8 }, { h: "What happened", w: 80 }, { h: "Detail", w: 120 }, { h: "Importance", w: 12 }], rows: eventRows },
    { name: "Website changes", holds: `Carrier marketing pages and brochures whose wording changed in the last ${WINDOW_DAYS} days, with the lines added and removed.`, source: "Monthly read of each carrier's public commercial product pages and documents. Pages behind a broker or employer login are not read.",
      cols: [{ h: "Changed", fmt: "date" }, { h: "Carrier", w: 36 }, { h: "Page", w: 50 }, { h: "Type", w: 12 }, { h: "Wording added", w: 120 }, { h: "Wording removed", w: 120 }, { h: "Link", w: 50 }], rows: rewordedRows },
  ];

  // ── Brief: the month in sentences ──
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const num = (v: number | null) => (v == null ? "n/a" : Math.round(v).toLocaleString("en-US"));
  const pct = (v: number | null) => (v == null ? "n/a" : `${(v * 100).toFixed(1)}%`);
  const brief: string[] = [];
  const counts = new Map<string, number>();
  for (const e of events) counts.set(kind(e.kind), (counts.get(kind(e.kind)) ?? 0) + 1);
  brief.push(events.length ? `Market changes in the last ${WINDOW_DAYS} days: ${events.length} in total (${[...counts].sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k.toLowerCase()} ${c}`).join(", ")}).` : `No market changes were detected in the last ${WINDOW_DAYS} days.`);
  for (const e of events.slice(0, 8)) brief.push(e.title.startsWith(e.carrier) ? `${day(e.occurredAt)} · ${e.title}` : `${day(e.occurredAt)} · ${e.carrier}${e.state ? ` (${e.state})` : ""}: ${e.title}`);
  if (us) {
    const mine = ov.filter((o) => o.period === "Latest available" && o.segment === "Large group" && o.carrier === us && n(o.lives) != null);
    for (const o of mine) {
      const peers = ov.filter((x) => x.period === "Latest available" && x.segment === "Large group" && x.state === o.state && n(x.lives) != null).sort((a, b) => n(b.lives)! - n(a.lives)!);
      brief.push(`${us}, ${o.state} large group, fully insured: ${num(n(o.lives))} members, rank ${peers.findIndex((x) => x.carrier === us) + 1} of ${peers.length} carriers; premium ${div(o.premium, o.mm) == null ? "n/a" : `$${num(div(o.premium, o.mm))}`} per member per month; loss ratio ${pct(div(o.claims, o.premium))}.`);
    }
  }
  if (reworded.length) brief.push(`Carrier websites: ${reworded.length} marketing pages or documents were reworded in the last ${WINDOW_DAYS} days (${[...new Set(reworded.map((v) => SITES.find((x) => x.key === v.site)?.label ?? v.site))].slice(0, 6).join(", ")}). See the Website changes tab.`);
  const recent = filings.filter((f) => f.createdAt >= since);
  brief.push(`State filings loaded: ${filings.length}${recent.length ? `, ${recent.length} added in the last ${WINDOW_DAYS} days` : ""}.`);
  for (const f of recent.slice(0, 6)) if (det(f.detail).headline) brief.push(`Filing · ${f.company ?? f.tracking}${f.market ? `, ${f.market}` : ""}${f.planYear ? ` ${f.planYear}` : ""}: ${det(f.detail).headline}`);
  const high = news.filter((x) => x.impact === 3);
  brief.push(`AI watch: ${news.length} relevant stories in the last ${WINDOW_DAYS} days, ${high.length} high impact.`);
  for (const x of high.slice(0, 5)) brief.push(`AI · ${x.title}${x.outlet ? ` (${x.outlet})` : ""}${x.why ? `: ${x.why}` : ""}`);

  // ── Workbook ──
  const wb = new ExcelJS.Workbook();
  wb.creator = "Payersight"; wb.created = new Date();
  const info = wb.addWorksheet("Read me");
  info.columns = [{ width: 28 }, { width: 90 }, { width: 110 }, { width: 10 }];
  const head = [[`${PACK_NAME} ${packDate()}`, ""], ["Generated", packDate()], ["Workspace", ws?.name ?? ""], ["Our carrier (rows marked “Is us”)", us ?? "Not set"], ["How to use", "Each tab is one table with one header row. Money is in US dollars, percentages are stored as fractions and shown as percent, and blank means not reported. The Brief tab summarises the month in sentences."]];
  head.forEach((r) => info.addRow(r));
  info.getRow(1).font = { bold: true, size: 14 };
  info.addRow([]);
  info.addTable({ name: "Tabs", ref: `A${head.length + 2}`, headerRow: true, style: { theme: "TableStyleLight1", showRowStripes: false }, columns: [{ name: "Tab" }, { name: "What it holds" }, { name: "Where it comes from" }, { name: "Rows" }], rows: [["Brief", "The month's main changes in sentences.", "Written from the other tabs.", brief.length], ...tabs.map((t) => [t.name, t.holds, t.source, t.rows.length])] });
  info.getColumn(2).alignment = { wrapText: true, vertical: "top" }; info.getColumn(3).alignment = { wrapText: true, vertical: "top" };

  const b = wb.addWorksheet("Brief");
  b.columns = [{ width: 160 }];
  b.addTable({ name: "Brief", ref: "A1", headerRow: true, style: { theme: "TableStyleLight1", showRowStripes: false }, columns: [{ name: "This month" }], rows: brief.map((l) => [l]) });
  b.getColumn(1).alignment = { wrapText: true, vertical: "top" };

  for (const t of tabs) {
    const sh = wb.addWorksheet(t.name, { views: [{ state: "frozen", ySplit: 1 }] });
    sh.columns = t.cols.map((c) => ({ width: c.w ?? (c.fmt === "date" ? 12 : Math.max(14, Math.min(40, c.h.length + 2))) }));
    const rows = t.rows.length ? t.rows : [t.cols.map((_, i) => (i === 0 ? "No rows this month" : null))];
    sh.addTable({ name: t.name.replace(/[^A-Za-z0-9]/g, ""), ref: "A1", headerRow: true, style: { theme: "TableStyleLight1", showRowStripes: false }, columns: t.cols.map((c) => ({ name: c.h, filterButton: true })), rows });
    t.cols.forEach((c, i) => { if (c.fmt) sh.getColumn(i + 1).numFmt = FMT[c.fmt]; if ((c.w ?? 0) >= 60) sh.getColumn(i + 1).alignment = { wrapText: true, vertical: "top" }; });
  }
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), brief };
}

export const packResponse = (buffer: Buffer) => new Response(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${packFilename()}"`, "Cache-Control": "no-store" } });
