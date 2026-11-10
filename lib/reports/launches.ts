import { db } from "../db";

/**
 * National report: new commercial (ACA individual + small group) products in every state's rate filings, which ones
 * took off, what kind of product they are, and who entered or left which markets.
 *
 * Source: CMS Unified Rate Review PUF (RatePlan), every carrier's filing for each plan year. A filing for plan year Y
 * is made mid-(Y−1) and reports enrollment at that time, so a product launched for Y shows its first real enrollment
 * in the Y+1 filing. Products are HIOS product ids; a launch = a product id whose plans are all "New" and which wasn't
 * in the prior year's filings. Carriers often re-file existing members into a new product or legal entity; a launch is
 * flagged as a likely migration when the same carrier terminated at least half as much enrollment in that state and
 * market the same year.
 */

export const THEMES = [
  { id: "medicaid", label: "Medicaid plan going commercial", re: /^$/, about: "A Medicaid managed-care organization selling exchange plans (AmeriHealth Caritas Next, CalOptima, L.A. Care, WellSense, CareSource …)." },
  { id: "partner", label: "Health-system co-branded", re: /\bwith [A-Z][\w&.' -]*(health|clinic|medical|hospital|physicians|care)\b|\b(cone|chi|baylor|mayo|cleveland clinic|ochsner|atrium|novant|advocate|piedmont|wellstar|emory|gwinnett|houston methodist|memorial hermann|hca|intermountain|sanford|essentia|allina|fairview|banner|honorhealth|sutter|providence|adventhealth|orlando health|baptist|ascension|trinity|bon secours|hackensack|northwell|nyu langone|jefferson|penn medicine|geisinger|upmc|ohiohealth|prisma|musc|unc health|duke|wakemed|bjc|mercy|ssm|beaumont|corewell|henry ford|spectrum)\b/i, about: "A network or product built around one health system, usually named for it." },
  { id: "provider", label: "Provider-owned plan", re: /^$/, about: "The carrier is itself a health system (CHRISTUS, Baylor Scott & White, Select Health, Harbor Health, Sentara …)." },
  { id: "dental", label: "Bundled dental / vision", re: /adult (dental|vision)|\bvision\b|\badav\b|\+\s*d\s*v\b|dental ?(&|and|\+) ?vision/i, about: "Adult dental and/or vision folded into the medical plan (pediatric dental alone doesn't count)." },
  { id: "narrow", label: "Narrow / value network", re: /\b(select|value|focus|essential|local|direct|core|tier(ed)?|narrow)\b/i, about: "A smaller or tiered network sold on price." },
  { id: "guided", label: "Guided / navigated care", re: /\b(guided|navigat\w*|coordinated|concierge|advocate|medical home)\b/i, about: "Care routed through a primary-care or navigation front door (referrals, care guides)." },
  { id: "primary", label: "$0 primary care / clinic partner", re: /\b(dpc|direct primary|marathon|sanitas|one medical|oak street|everside|carbon health|\$?0 pcp|\$0 primary|free (pcp|primary|visits?)|three free|unlimited .{0,30}visits|\$5 pcp)\b/i, about: "Free or near-free primary care, often through a direct-primary-care or clinic partner (Marathon, Sanitas, DPC)." },
  { id: "virtual", label: "Virtual-first", re: /\b(virtual|telehealth|digital|antidote|teladoc|app-based)\b/i, about: "Telehealth as the first stop, sometimes unlimited and free." },
  { id: "condition", label: "Condition-specific plan", re: /\b(diabetes|diabetic|copd|breathe easy|asthma|heart|cardio|chronic condition|kidney|renal|cancer|maternity|behavioral|hiv)\b/i, about: "Plan designs built for one chronic condition, with lower cost sharing for its drugs and visits." },
  { id: "rewards", label: "Rewards / incentives", re: /\b(rewards?|incentives?|cash back|earn)\b/i, about: "Member rewards for healthy actions built into the plan." },
  { id: "copay", label: "Copay-only / no deductible", re: /\b(copay|no deductible|\$0 deductible|zero deductible|0 ded|surest|bind|predictable|simple|clear ?price)\b/i, about: "Flat copays instead of a deductible and coinsurance." },
  { id: "hsa", label: "HSA / high deductible", re: /\b(hsa|hdhp|high deductible|saver)\b/i, about: "HSA-qualified high-deductible designs." },
  { id: "public", label: "Public option / standardized", re: /\b(public option|colorado option|cascade|standard(ized)?|clear choice)\b/i, about: "State public-option or standardized designs." },
  { id: "regional", label: "City or regional product", re: /\b(houston|dallas|austin|san antonio|atlanta|miami|tampa|orlando|jacksonville|phoenix|tucson|chicago|detroit|charlotte|raleigh|nashville|memphis|denver|las vegas|new orleans|birmingham|oklahoma city|kansas city|st\.? louis|indianapolis|columbus|cincinnati|cleveland|pittsburgh|philadelphia|richmond|norfolk|salt lake|boise|portland|seattle|metro|valley|coast|county)\b/i, about: "A product named for and limited to one metro area." },
] as const;
export type ThemeId = (typeof THEMES)[number]["id"];

const PROVIDER_OWNED = /christus|baylor scott|select ?health|harbor health|sentara|geisinger|intermountain|presbyterian|sanford|ochsner|healthpartners|kaiser|mass general brigham|providence|adventhealth|health first|allina|avera|dean health|quartz|gundersen|security health|mercy|ssm health|upmc|priority health|scott & white|health alliance|paramount|summa|aultcare|baptist health|piedmont|wellstar|banner|honorhealth|prominence|sutter|western health advantage|valley health plan|sharp|moda|pacificsource|samaritan|essence|indiana university|iu health|wellfirst|bswhp/i;

const BRANDS: Array<[string, RegExp]> = [
  ["UPMC", /upmc/i], // before Centene: "UPMC Health Network" contains "Health Net"
  ["Centene (Ambetter)", /ambetter|bankers reserve|nebraska total care|celtic|centene|coordinated care|superior health plan|sunshine|peach state|iowa total care|health net(?!work)|absolute total|buckeye|magnolia|arizona complete|meridian|wellcare|home state|louisiana healthcare|silversummit|nh healthy|managed health services|western sky|carolina complete|arkansas health|sunflower|qca health/i],
  ["Oscar", /oscar/i],
  ["Elevance (Anthem/Wellpoint)", /anthem|wellpoint|simply healthcare|healthkeepers|empire|amerigroup|community insurance company|hmo colorado|rocky mountain hospital|matthew thornton|compcare|blue cross of california|healthy alliance/i],
  ["UnitedHealthcare", /unitedhealthcare|\buhc|optimum choice|oxford health|all savers|golden rule|mamsi|neighborhood health partnership|sierra health|^health plan of nevada|rocky mountain health/i],
  ["Cigna", /cigna/i], ["Aetna (CVS)", /aetna|coventry/i], ["Molina", /molina/i], ["Kaiser Permanente", /kaiser/i],
  ["HCSC (BCBS IL/TX/OK/NM/MT)", /blue cross (and |& )?blue shield of (illinois|texas|oklahoma|new mexico|montana)/i],
  ["Florida Blue", /^health options, inc|blue cross (and |& )?blue shield of florida/i],
  ["Highmark", /highmark/i], ["Independence / AmeriHealth", /keystone health plan east|qcc insurance|amerihealth(?! caritas)/i],
  ["CareSource", /caresource/i], ["Baylor Scott & White", /baylor scott|scott and white|scott & white/i], ["Providence", /providence health plan/i], ["Medica", /\bmedica\b/i], ["Select Health", /select ?health/i], ["Regence / Cambia", /regence|bridgespan|asuris/i],
  ["Blue Shield of California", /blue shield of california/i], ["CareFirst", /carefirst/i], ["Point32Health", /tufts|harvard pilgrim/i],
];
export function brandOf(company: string): string {
  for (const [b, re] of BRANDS) if (re.test(company)) return b;
  return company.replace(/,?\s*(inc|llc|corp(oration)?|company|co)\.?$/i, "").replace(/\s+/g, " ").trim();
}
const MEDICAID_MCO = /amerihealth caritas|caloptima|orange county health authority|l\.?a\.? care|local initiative health authority|caresource|community health choice|wellsense|boston medical center health plan|fidelis|healthfirst|metroplus|inland empire|iehp|partnership health|community first|driscoll|texas children|parkland|cook children|elevate|passport|aetna better health|sunshine health|simply healthcare|molina/i;
/** Distinctive designs count if any plan has them; common variants (dental, HSA, network tier) need half the plans. */
const ANY_PLAN = new Set<string>(["condition", "primary", "virtual", "rewards", "guided", "partner"]);
/** Themes from the product name, or from its plan names (so one odd HSA plan doesn't make it an HSA product). */
export const themesOf = (product: string, plans: string[], company: string): ThemeId[] => {
  const t = THEMES.filter((x) => x.id !== "provider" && x.id !== "medicaid" && (x.re.test(product) || (plans.length > 0 && (ANY_PLAN.has(x.id) ? plans.some((n) => x.re.test(n)) : plans.filter((n) => x.re.test(n)).length * 2 >= plans.length)))).map((x) => x.id);
  if (PROVIDER_OWNED.test(company)) t.push("provider");
  if (MEDICAID_MCO.test(company)) t.push("medicaid");
  return t;
};

type Row = { y: number; hios: string; proj: number | null; state: string; company: string; market: string; pid: string; pname: string; plid: string; plname: string; metal: string | null; ptype: string | null; onx: boolean; cat: string; enr: number; pmpm: number | null; rc: number | null };
export type Launch = {
  year: number; state: string; market: string; company: string; brand: string; productId: string; name: string; planType: string | null; plans: number; onExchange: number; metals: string[];
  themes: ThemeId[]; examples: string[]; nextEnrolled: number | null; laterEnrolled: number | null; share: number | null; migrated: boolean; brandTerminated: number; brandGrowth: number | null; premium: number | null; marketPremium: number | null;
};
export type Move = { year: number; state: string; market: string; brand: string; kind: "entry" | "exit"; enrolled: number; products: number };
export type LaunchReport = {
  years: number[]; generatedAt: string; launches: Launch[]; moves: Move[];
  byYear: Array<{ year: number; launches: number; netNew: number; migrated: number; individual: number; smallGroup: number; carriers: number; states: number; entries: number; exits: number }>;
  themes: Array<{ id: ThemeId; label: string; about: string; byYear: Record<number, number>; measured: number; medianEnrolled: number | null; hitRate: number | null; topExample: Launch | null }>;
  brands: Array<{ brand: string; launches: number; netNewEnrolled: number; states: number; entries: number; exits: number; best: Launch | null }>;
};

const median = (xs: number[]) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export async function buildLaunchReport(): Promise<LaunchReport> {
  const rows = await db.$queryRaw<Row[]>`
    SELECT DISTINCT ON ("planYear", "planId") "planYear" y, "hiosId" hios, "projPremiumPmpm" proj, state, company, market, "productId" pid, "productName" pname, "planId" plid, "planName" plname, metal, "planType" ptype, "onExchange" onx, category cat, coalesce(enrollment, 0)::int enr, "ratePmpm" pmpm, "rateChange" rc
    FROM "RatePlan" ORDER BY "planYear", "planId", "effectiveDate" DESC`;
  const years = [...new Set(rows.map((r) => r.y))].sort();
  const live = (r: Row) => r.cat !== "Terminated";
  const byYear = new Map<number, Row[]>(years.map((y) => [y, rows.filter((r) => r.y === y)]));
  const pidsIn = new Map<number, Set<string>>(years.map((y) => [y, new Set(byYear.get(y)!.map((r) => r.pid))]));
  const plansIn = new Map<number, Map<string, Row>>(years.map((y) => [y, new Map(byYear.get(y)!.map((r) => [r.plid, r]))]));
  const key = (...p: Array<string | number>) => p.join("|");

  // State × market totals and brand totals per filing year.
  const mkt = new Map<string, number>(), brandMkt = new Map<string, number>(), brandTerm = new Map<string, number>(), mktPrem = new Map<string, number[]>();
  for (const r of rows) {
    const b = brandOf(r.company);
    if (live(r)) {
      mkt.set(key(r.y, r.state, r.market), (mkt.get(key(r.y, r.state, r.market)) ?? 0) + r.enr);
      brandMkt.set(key(r.y, r.state, r.market, b), (brandMkt.get(key(r.y, r.state, r.market, b)) ?? 0) + r.enr);
      if (r.proj && r.proj > 0) (mktPrem.get(key(r.y, r.state, r.market)) ?? mktPrem.set(key(r.y, r.state, r.market), []).get(key(r.y, r.state, r.market))!).push(r.proj);
    } else brandTerm.set(key(r.y, r.state, r.market, b), (brandTerm.get(key(r.y, r.state, r.market, b)) ?? 0) + r.enr);
  }

  const launches: Launch[] = [];
  for (const y of years) {
    const groups = new Map<string, Row[]>();
    for (const r of byYear.get(y)!) (groups.get(r.pid) ?? groups.set(r.pid, []).get(r.pid)!).push(r);
    for (const [pid, xs] of groups) {
      if (!xs.every((r) => r.cat === "New")) continue;
      if (y > years[0] && pidsIn.get(y - 1)!.has(pid)) continue;
      const x0 = xs[0], brand = brandOf(x0.company);
      // Enrollment in later filings: the same plan ids (or product id) wherever they are filed.
      const later = (yy: number) => {
        if (!pidsIn.has(yy)) return null;
        let n = 0;
        const seen = new Set<string>();
        for (const r of xs) { const p = plansIn.get(yy)!.get(r.plid); if (p && live(p)) { n += p.enr; seen.add(p.plid); } }
        for (const r of byYear.get(yy)!) if (r.pid === pid && live(r) && !seen.has(r.plid)) n += r.enr;
        return n;
      };
      const next = later(y + 1), after = later(y + 2);
      // Members the carrier moved: plans it terminated this year, plus last year's members under any of its issuer ids
      // that no longer file in this state and market.
      // (Renumbered plans count too: a plan id in last year's filing with no live plan this year.)
      const vanished = byYear.get(y - 1)?.filter((r) => live(r) && r.state === x0.state && r.market === x0.market && brandOf(r.company) === brand && !(plansIn.get(y)!.get(r.plid) && live(plansIn.get(y)!.get(r.plid)!))).reduce((s, r) => s + r.enr, 0) ?? 0;
      const term = Math.max(brandTerm.get(key(y, x0.state, x0.market, brand)) ?? 0, vanished);
      const measured = after ?? next;
      const tot = mkt.get(key(y + 1, x0.state, x0.market));
      const bNow = brandMkt.get(key(y, x0.state, x0.market, brand)), bNext = brandMkt.get(key(y + 1, x0.state, x0.market, brand));

      launches.push({
        year: y, state: x0.state, market: x0.market, company: x0.company, brand, productId: pid, name: x0.pname.trim() || xs[0].plname, planType: x0.ptype,
        plans: xs.length, onExchange: xs.filter((r) => r.onx).length, metals: [...new Set(xs.map((r) => r.metal).filter(Boolean) as string[])],
        themes: themesOf(x0.pname, xs.map((r) => r.plname), x0.company), examples: [...new Set(xs.map((r) => r.plname.trim()))].slice(0, 3),
        nextEnrolled: next, laterEnrolled: after, share: next != null && tot ? next / tot : null,
        migrated: measured != null && measured > 500 && term >= 0.5 * measured, brandTerminated: term,
        brandGrowth: bNow && bNext != null && bNow >= 500 ? bNext / bNow - 1 : null,
        premium: median(xs.map((r) => (r.proj && r.proj > 0 ? r.proj : NaN))), marketPremium: median(mktPrem.get(key(y, x0.state, x0.market)) ?? []),
      });
    }
  }

  // Market entries and exits by carrier brand.
  const moves: Move[] = [];
  for (const y of years.slice(1)) {
    // By HIOS issuer id, which survives legal-name changes; a carrier moving members to a sister entity in the same
    // state and market the same year (same brand on both sides) is a re-filing, not an entry plus an exit.
    const present = (yy: number) => { const m = new Map<string, { enr: number; products: Set<string>; company: string }>(); for (const r of byYear.get(yy)!) if (live(r)) { const k = key(r.state, r.market, r.hios); const v = m.get(k) ?? m.set(k, { enr: 0, products: new Set(), company: r.company }).get(k)!; v.enr += r.enr; v.products.add(r.pid); } return m; };
    const a = present(y - 1), b = present(y);
    const ins = [...b].filter(([k]) => !a.has(k)).map(([k, v]) => ({ k, v, brand: brandOf(v.company) }));
    const outs = [...a].filter(([k]) => !b.has(k)).map(([k, v]) => ({ k, v, brand: brandOf(v.company) }));
    const sm = (k: string) => k.split("|").slice(0, 2).join("|");
    const stays = (side: typeof ins, other: typeof ins, x: (typeof ins)[number]) => other.some((o) => sm(o.k) === sm(x.k) && o.brand === x.brand) || [...(side === ins ? a : b)].some(([k, v]) => sm(k) === sm(x.k) && brandOf(v.company) === x.brand);
    for (const x of ins) if (!stays(ins, outs, x)) { const [state, market] = x.k.split("|"); moves.push({ year: y, state, market, brand: x.brand, kind: "entry", enrolled: x.v.enr, products: x.v.products.size }); }
    for (const x of outs) if (!stays(outs, ins, x)) { const [state, market] = x.k.split("|"); moves.push({ year: y, state, market, brand: x.brand, kind: "exit", enrolled: x.v.enr, products: x.v.products.size }); }
  }

  const real = launches.filter((l) => !l.migrated);
  const report: LaunchReport = {
    years, generatedAt: new Date().toISOString(), launches, moves,
    byYear: years.map((y) => {
      const ls = launches.filter((l) => l.year === y);
      return { year: y, launches: ls.length, netNew: ls.filter((l) => !l.migrated).length, migrated: ls.filter((l) => l.migrated).length, individual: ls.filter((l) => l.market === "Individual").length, smallGroup: ls.filter((l) => l.market !== "Individual").length, carriers: new Set(ls.map((l) => l.brand)).size, states: new Set(ls.map((l) => l.state)).size, entries: moves.filter((m) => m.year === y && m.kind === "entry").length, exits: moves.filter((m) => m.year === y && m.kind === "exit").length };
    }),
    themes: THEMES.map((t) => {
      const ls = real.filter((l) => l.themes.includes(t.id));
      const m = ls.filter((l) => l.nextEnrolled != null);
      return {
        id: t.id, label: t.label, about: t.about, byYear: Object.fromEntries(years.map((y) => [y, ls.filter((l) => l.year === y).length])),
        measured: m.length, medianEnrolled: median(m.map((l) => (l.laterEnrolled ?? l.nextEnrolled)!)), hitRate: m.length ? m.filter((l) => (l.laterEnrolled ?? l.nextEnrolled)! >= 5000).length / m.length : null,
        topExample: [...m].sort((a, b) => (b.laterEnrolled ?? b.nextEnrolled)! - (a.laterEnrolled ?? a.nextEnrolled)!)[0] ?? null,
      };
    }),
    brands: [...new Set(launches.map((l) => l.brand))].map((brand) => {
      const ls = launches.filter((l) => l.brand === brand);
      const r = ls.filter((l) => !l.migrated);
      return { brand, launches: ls.length, netNewEnrolled: r.reduce((s, l) => s + (l.laterEnrolled ?? l.nextEnrolled ?? 0), 0), states: new Set(ls.map((l) => l.state)).size, entries: moves.filter((m) => m.brand === brand && m.kind === "entry").length, exits: moves.filter((m) => m.brand === brand && m.kind === "exit").length, best: [...r].sort((a, b) => (b.laterEnrolled ?? b.nextEnrolled ?? -1) - (a.laterEnrolled ?? a.nextEnrolled ?? -1))[0] ?? null };
    }).filter((b) => b.launches >= 2 || b.entries + b.exits >= 2).sort((a, b) => b.netNewEnrolled - a.netNewEnrolled || b.launches - a.launches),
  };
  return report;
}

/** Cached: rebuilt when the filings change (row count / latest year) or after a day. */
export async function launchReport(): Promise<LaunchReport | null> {
  const sig = await db.$queryRaw<Array<{ n: bigint; y: number | null }>>`SELECT count(*) n, max("planYear") y FROM "RatePlan"`;
  if (!sig[0]?.y) return null;
  const stamp = `${sig[0].n}:${sig[0].y}`;
  const id = "cache:report:launches";
  const c = (await db.rateFile.findUnique({ where: { id } }))?.stats as { stamp?: string; at?: string; report?: LaunchReport } | null;
  if (c?.stamp === stamp && c.report && Date.now() - new Date(c.at!).getTime() < 864e5) return c.report;
  const report = await buildLaunchReport();
  const data = { carrier: "_cache", carrierName: "_cache", network: "report-launches", url: "", status: "cache", stats: JSON.parse(JSON.stringify({ stamp, at: new Date().toISOString(), report })), processedAt: new Date() };
  await db.rateFile.upsert({ where: { id }, create: { id, ...data }, update: data }).catch(() => {});
  return report;
}
