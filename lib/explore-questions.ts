/**
 * The Data explorer's starting points: questions people actually ask, grouped by topic. Each is a saved pivot layout
 * over one dataset (see lib/explore.ts for the field keys). State is left to the explorer's own State control.
 */
export type Question = { id: string; label: string; ds: string; rows: string[]; col?: string; vals: string[]; f?: Record<string, string[]>; top?: number; chart?: boolean; sort?: string };
export type Topic = { id: string; label: string; questions: Question[] };
const LG = { segment: ["Large group"] }, IND = { segment: ["Individual"] };

export const TOPICS: Topic[] = [
  { id: "share", label: "Share & growth", questions: [
    { id: "share-lg", label: "Large-group market share", ds: "financials", rows: ["carrier"], col: "year", vals: ["lives:sum:pctCol"], f: LG, chart: true },
    { id: "growth", label: "Membership growth year over year", ds: "financials", rows: ["carrier"], col: "year", vals: ["lives:sum:value", "lives:sum:chg"], f: LG },
    { id: "segments", label: "Members by segment and carrier", ds: "financials", rows: ["segment", "carrier"], col: "year", vals: ["lives:sum:value"], top: 6 },
    { id: "funding", label: "Fully insured vs self-funded", ds: "enrollment", rows: ["funding"], col: "year", vals: ["members:sum:value", "members:sum:pctCol"], f: { ...LG, quarter: ["Q3"] } },
    { id: "aso", label: "Who administers self-funded plans", ds: "enrollment", rows: ["carrier"], col: "year", vals: ["members:sum:value"], f: { ...LG, quarter: ["Q3"], funding: ["Self-funded"] }, chart: true },
    { id: "groupsize", label: "Members by group size", ds: "enrollment", rows: ["size"], col: "year", vals: ["members:sum:value"], f: { quarter: ["Q3"] } },
  ] },
  { id: "price", label: "Price & margin", questions: [
    { id: "pmpm", label: "Premium per member by carrier", ds: "financials", rows: ["carrier"], col: "year", vals: ["pmpm:ratio:value"], f: LG, chart: true },
    { id: "lr", label: "Loss ratio by carrier", ds: "financials", rows: ["carrier"], col: "year", vals: ["lr:ratio:value"], f: LG },
    { id: "ratechg", label: "Filed rate changes", ds: "plans", rows: ["carrier"], col: "year", vals: ["rate:wavg:value"], f: IND },
    { id: "metal", label: "Premiums by metal tier", ds: "plans", rows: ["metal", "carrier"], col: "year", vals: ["prem40:avg:value"], f: IND },
    { id: "lgrates", label: "Large-group rate requests vs approved", ds: "rates", rows: ["carrier"], col: "year", vals: ["requested:wavg:value", "approved:wavg:value"] },
    { id: "ppm", label: "What employers pay per person", ds: "employers", rows: ["carrier"], col: "year", vals: ["ppm:ratio:value"], top: 12 },
    { id: "gic", label: "GIC premiums by plan", ds: "gic", rows: ["carrier", "plan"], col: "year", vals: ["indPrem:avg:value"] },
  ] },
  { id: "products", label: "Products & design", questions: [
    { id: "lineup", label: "Plans and members by carrier", ds: "plans", rows: ["carrier"], col: "year", vals: ["_count:count:value", "members:sum:value"], f: IND },
    { id: "nettype", label: "Network type mix", ds: "plans", rows: ["ntype"], col: "year", vals: ["members:sum:pctCol"] },
    { id: "newterm", label: "New and terminated plans", ds: "plans", rows: ["carrier"], col: "year", vals: ["isNew:sum:value", "term:sum:value"] },
    { id: "ded", label: "Deductibles by metal tier", ds: "plans", rows: ["metal"], col: "year", vals: ["ded:median:value"], f: IND },
    { id: "tiered", label: "Tiered-network plans by carrier", ds: "plans", rows: ["carrier"], col: "tiered", vals: ["_count:count:pctRow"] },
    { id: "sold", label: "How products are sold", ds: "marketed", rows: ["carrier"], col: "network", vals: ["_products:distinct:value"] },
    { id: "partners", label: "Vendors and partners", ds: "marketed", rows: ["partner", "carrier"], vals: ["_products:distinct:value"] },
  ] },
  { id: "employers", label: "Employers & brokers", questions: [
    { id: "book", label: "Employer accounts by carrier", ds: "employers", rows: ["carrier"], col: "year", vals: ["_employers:distinct:value", "persons:sum:value"], top: 12 },
    { id: "sizemix", label: "Insured vs self-funded by employer size", ds: "employers", rows: ["size"], col: "funding", vals: ["_employers:distinct:pctRow"] },
    { id: "brokers", label: "Top brokers", ds: "employers", rows: ["broker"], vals: ["_employers:distinct:value", "premium:sum:value", "brk:ratio:value"], top: 20, sort: "1:desc" },
    { id: "renewals", label: "Renewal months by carrier", ds: "employers", rows: ["carrier"], col: "renewal", vals: ["_employers:distinct:value"], top: 10 },
    { id: "industry", label: "Premium per person by industry", ds: "employers", rows: ["industry"], col: "year", vals: ["ppm:ratio:value"] },
    { id: "stoploss", label: "Stop-loss carriers", ds: "employers", rows: ["stoploss"], vals: ["_employers:distinct:value", "participants:sum:value"], f: { funding: ["Self-funded"] }, top: 20 },
  ] },
  { id: "filings", label: "State filings", questions: [
    { id: "serff", label: "SERFF filings by carrier and market", ds: "serff", rows: ["carrier"], col: "market", vals: ["_count:count:value"] },
    { id: "serffnew", label: "Filings with new products", ds: "serff", rows: ["carrier", "product"], col: "newProduct", vals: ["_count:count:value"] },
  ] },
];
export const DEFAULT_STATE = "MA";
export function questionQuery(q: Question, state: string[] | null = [DEFAULT_STATE]): string {
  const p = new URLSearchParams();
  p.set("ds", q.ds); p.set("q", q.id); p.set("rows", q.rows.join(","));
  if (q.col) p.set("col", q.col);
  p.set("vals", q.vals.join("|"));
  const f = { ...(q.f ?? {}), ...(state?.length && !["gic", "marketed", "serff", "rates"].includes(q.ds) ? { state } : {}) };
  if (Object.keys(f).length) p.set("f", JSON.stringify(f));
  if (q.top) p.set("top", String(q.top));
  if (q.chart) p.set("chart", "1");
  if (q.sort) p.set("sort", q.sort);
  return p.toString();
}
