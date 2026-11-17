/**
 * The Data explorer's optional starting points: one broad view per topic, plus the overview it opens on.
 * Each is a pivot layout over one dataset (see lib/explore.ts for the field keys).
 */
export type Question = { id: string; label: string; ds: string; rows: string[]; col?: string; vals: string[]; f?: Record<string, string[]>; top?: number; chart?: boolean; sort?: string };
const EACH = { period: ["Each year"] };

export const OVERVIEW: Question = { id: "overview", label: "Carrier overview", ds: "overview", rows: ["carrier"], vals: ["lives:sum:value", "lives:sum:pctCol", "pmpm:ratio:value", "lr:ratio:value", "sf:sum:value", "emps:sum:value", "ppm:ratio:value", "plans:sum:value", "rate:ratio:value"], f: { period: ["Latest available"] }, top: 15 };
export const TOPICS: Question[] = [
  { id: "share", label: "Share & growth", ds: "overview", rows: ["carrier"], col: "year", vals: ["lives:sum:value", "lives:sum:pctCol"], f: EACH, top: 15 },
  { id: "price", label: "Price & margin", ds: "overview", rows: ["carrier"], col: "year", vals: ["lives:sum:value", "pmpm:ratio:value", "lr:ratio:value"], f: EACH, top: 12 },
  { id: "products", label: "Products & design", ds: "plans", rows: ["carrier"], col: "year", vals: ["_count:count:value", "members:sum:value", "prem40:avg:value"] },
  { id: "employers", label: "Employers & brokers", ds: "employers", rows: ["carrier"], col: "year", vals: ["_employers:distinct:value", "persons:sum:value", "ppm:ratio:value"], top: 15 },
  { id: "filings", label: "State filings", ds: "serff", rows: ["carrier"], col: "market", vals: ["_count:count:value"] },
];
export const DEFAULT_STATE = "MA";
export function questionQuery(q: Question, state: string[] | null = [DEFAULT_STATE], extra: Record<string, string[]> = {}): string {
  const p = new URLSearchParams();
  p.set("ds", q.ds); p.set("q", q.id); p.set("rows", q.rows.join(","));
  if (q.col) p.set("col", q.col);
  p.set("vals", q.vals.join("|"));
  const f = { ...extra, ...(q.f ?? {}), ...(state?.length && !["gic", "marketed", "serff", "rates"].includes(q.ds) ? { state } : {}) };
  if (Object.keys(f).length) p.set("f", JSON.stringify(f));
  if (q.top) p.set("top", String(q.top));
  if (q.chart) p.set("chart", "1");
  if (q.sort) p.set("sort", q.sort);
  return p.toString();
}
