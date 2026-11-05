/**
 * Starter packs: one click seeds a workspace with competitors (aliases, tiers) and news sources.
 * Idempotent — re-running skips competitors and sources that already exist.
 *
 * Google News queries are deliberately specific: payer names collide with hospitals, towns and
 * unrelated companies, and quoted names + context words keep the feed usable.
 */

const gnews = (q: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

export type StarterCompetitor = {
  name: string;
  aliases: string[];
  tier: 1 | 2 | 3;
  website?: string;
  query: string; // Google News query for this competitor's own source
};

/**
 * Shared identities: the same company keeps one name across packs, so loading MA then NH merges
 * into one competitor (aliases unioned) with one state-scoped news source per pack.
 */
const C = {
  point32: { name: "Point32Health", aliases: ["point32health", "harvard pilgrim", "harvard pilgrim health care", "tufts health plan"], website: "https://www.point32health.org", terms: '"Point32Health" OR "Harvard Pilgrim" OR "Tufts Health Plan"' },
  uhc: { name: "UnitedHealthcare", aliases: ["unitedhealthcare", "united healthcare", "unitedhealth", "unitedhealth group", "uhc", "optum"], website: "https://www.uhc.com", terms: '"UnitedHealthcare" OR "UnitedHealth"' },
  aetna: { name: "Aetna", aliases: ["aetna", "cvs health"], website: "https://www.aetna.com", terms: '"Aetna"' },
  cigna: { name: "Cigna", aliases: ["cigna", "the cigna group", "evernorth"], website: "https://www.cigna.com", terms: '"Cigna"' },
  elevance: { name: "Elevance Health (Anthem)", aliases: ["elevance", "elevance health", "anthem", "anthem blue cross", "carelon", "wellpoint"], website: "https://www.elevancehealth.com", terms: '"Anthem" OR "Elevance Health"' },
  centene: { name: "Centene (Ambetter)", aliases: ["centene", "ambetter", "wellcare", "health net", "nh healthy families", "celtic insurance"], website: "https://www.centene.com", terms: '"Centene" OR "Ambetter"' },
  wellsense: { name: "WellSense Health Plan", aliases: ["wellsense", "bmc healthnet"], website: "https://www.wellsense.org", terms: '"WellSense" OR "BMC HealthNet"' },
} as const;

type Shared = (typeof C)[keyof typeof C];
const inState = (c: Shared, tier: 1 | 2 | 3, state: string): StarterCompetitor => ({
  name: c.name, aliases: [...c.aliases], tier, website: c.website, query: `(${c.terms}) "${state}"`,
});
const national = (c: Shared, tier: 1 | 2 | 3): StarterCompetitor => ({
  name: c.name, aliases: [...c.aliases], tier, website: c.website, query: `(${c.terms}) (insurer OR "health plan" OR earnings OR "Medicare Advantage")`,
});

export type StarterPack = {
  id: string;
  name: string;
  description: string;
  competitors: StarterCompetitor[];
  marketSources: Array<{ name: string; url: string }>; // general, auto-attributed per item
};

export const STARTER_PACKS: StarterPack[] = [
  {
    id: "ma-commercial-payers",
    name: "Massachusetts",
    description: "Local plans, nationals operating in MA, and state market/regulatory news.",
    competitors: [
      { name: "Blue Cross Blue Shield of Massachusetts", aliases: ["bcbsma", "blue cross blue shield of massachusetts", "blue cross massachusetts"], tier: 1, website: "https://www.bluecrossma.org", query: '"Blue Cross Blue Shield of Massachusetts" OR "BCBSMA"' },
      { ...inState(C.point32, 1, "Massachusetts"), query: C.point32.terms }, // v0.2 query kept so reloading MA adds no duplicates
      { name: "Mass General Brigham Health Plan", aliases: ["mass general brigham health plan", "allways health partners", "mgb health plan"], tier: 1, website: "https://www.massgeneralbrighamhealthplan.org", query: '"Mass General Brigham Health Plan" OR "AllWays Health Partners"' },
      { name: "Fallon Health", aliases: ["fallon health", "fallon community health plan"], tier: 2, website: "https://www.fallonhealth.org", query: '"Fallon Health"' },
      { name: "Health New England", aliases: ["health new england"], tier: 2, website: "https://healthnewengland.org", query: '"Health New England" insurer OR plan' },
      { ...inState(C.wellsense, 2, "Massachusetts"), query: C.wellsense.terms },
      { ...inState(C.uhc, 1, "Massachusetts"), query: '"UnitedHealthcare" (Massachusetts OR "New England" OR employer OR commercial)' },
      { ...inState(C.aetna, 2, "Massachusetts"), query: '"Aetna" (Massachusetts OR "New England" OR employer OR commercial)' },
      { ...inState(C.cigna, 2, "Massachusetts"), query: '"Cigna" (Massachusetts OR "New England" OR employer OR commercial)' },
    ],
    marketSources: [
      { name: "Healthcare Dive", url: "https://www.healthcaredive.com/feeds/news/" },
      { name: "MA health insurance news", url: gnews('Massachusetts "health insurance" OR "health plan" premiums OR rates') },
      { name: "MA Division of Insurance", url: gnews('"Massachusetts Division of Insurance" health') },
      { name: "MA Health Connector", url: gnews('"Massachusetts Health Connector"') },
      { name: "MA Health Policy Commission", url: gnews('"Health Policy Commission" Massachusetts') },
    ],
  },
  {
    id: "nh-commercial-payers",
    name: "New Hampshire",
    description: "Carriers filing 2026 individual/small-group rates in NH, plus group-market nationals and NH Insurance Dept news.",
    competitors: [
      inState(C.elevance, 1, "New Hampshire"),
      inState(C.point32, 1, "New Hampshire"),
      inState(C.centene, 2, "New Hampshire"),
      inState(C.wellsense, 2, "New Hampshire"),
      inState(C.uhc, 2, "New Hampshire"),
      inState(C.cigna, 2, "New Hampshire"),
      inState(C.aetna, 3, "New Hampshire"),
    ],
    marketSources: [
      { name: "NH health insurance news", url: gnews('"New Hampshire" "health insurance" OR "health plan" premiums OR rates') },
      { name: "NH Insurance Department", url: gnews('"New Hampshire Insurance Department" health') },
    ],
  },
  {
    id: "me-commercial-payers",
    name: "Maine",
    description: "The 2026 individual/small-group carriers per Maine's Bureau of Insurance, plus group-market nationals and CoverME news.",
    competitors: [
      inState(C.elevance, 1, "Maine"),
      inState(C.point32, 1, "Maine"),
      { name: "Community Health Options", aliases: ["community health options", "maine community health options"], tier: 1, website: "https://www.healthoptions.org", query: '"Community Health Options" Maine' },
      { name: "Taro Health", aliases: ["taro health", "mending health"], tier: 2, website: "https://www.tarohealth.com", query: '"Taro Health"' },
      inState(C.uhc, 2, "Maine"),
      inState(C.aetna, 3, "Maine"),
      inState(C.cigna, 3, "Maine"),
    ],
    marketSources: [
      { name: "ME health insurance news", url: gnews('Maine "health insurance" OR "health plan" premiums OR rates') },
      { name: "ME Bureau of Insurance", url: gnews('"Maine Bureau of Insurance" health') },
      { name: "CoverME.gov", url: gnews('"CoverME" Maine') },
    ],
  },
  {
    id: "ri-commercial-payers",
    name: "Rhode Island",
    description: "Carriers in OHIC's 2026 rate review (individual, small and large group), plus OHIC and HealthSource RI news.",
    competitors: [
      { name: "Blue Cross & Blue Shield of Rhode Island", aliases: ["bcbsri", "blue cross & blue shield of rhode island", "blue cross blue shield of rhode island", "blue cross rhode island"], tier: 1, website: "https://www.bcbsri.com", query: '"Blue Cross & Blue Shield of Rhode Island" OR "BCBSRI" OR "Blue Cross Blue Shield of Rhode Island"' },
      { name: "Neighborhood Health Plan of Rhode Island", aliases: ["neighborhood health plan", "neighborhood health plan of rhode island", "nhpri"], tier: 1, website: "https://www.nhpri.org", query: '"Neighborhood Health Plan of Rhode Island"' },
      inState(C.uhc, 1, "Rhode Island"),
      inState(C.point32, 2, "Rhode Island"),
      inState(C.aetna, 3, "Rhode Island"),
      inState(C.cigna, 3, "Rhode Island"),
    ],
    marketSources: [
      { name: "RI health insurance news", url: gnews('"Rhode Island" "health insurance" OR "health plan" premiums OR rates') },
      { name: "RI OHIC", url: gnews('"Office of the Health Insurance Commissioner" Rhode Island') },
      { name: "HealthSource RI", url: gnews('"HealthSource RI"') },
    ],
  },
  {
    id: "national-payers",
    name: "National",
    description: "The big publicly traded and national plans, plus CMS, KFF Health News and industry news. Noisier — pair with an importance ≥ 3 filter.",
    competitors: [
      national(C.uhc, 1),
      national(C.elevance, 1),
      national(C.aetna, 1),
      national(C.cigna, 1),
      { name: "Humana", aliases: ["humana", "centerwell"], tier: 2, website: "https://www.humana.com", query: '"Humana" (insurer OR earnings OR "Medicare Advantage")' },
      national(C.centene, 2),
      { name: "Molina Healthcare", aliases: ["molina", "molina healthcare"], tier: 3, website: "https://www.molinahealthcare.com", query: '"Molina Healthcare"' },
      { name: "Oscar Health", aliases: ["oscar health"], tier: 3, website: "https://www.hioscar.com", query: '"Oscar Health"' },
      { name: "Kaiser Permanente", aliases: ["kaiser permanente", "kaiser foundation health plan", "risant health"], tier: 3, website: "https://healthy.kaiserpermanente.org", query: '"Kaiser Permanente" OR "Risant Health"' },
      { name: "HCSC", aliases: ["hcsc", "health care service corporation"], tier: 3, website: "https://www.hcsc.com", query: '"Health Care Service Corporation" OR "HCSC" insurer' },
    ],
    marketSources: [
      { name: "Healthcare Dive", url: "https://www.healthcaredive.com/feeds/news/" },
      { name: "CMS Newsroom", url: "https://www.cms.gov/newsroom/rss-feeds" },
      { name: "KFF Health News", url: "https://kffhealthnews.org/feed/" },
      { name: "Health insurer industry news", url: gnews('"health insurers" OR "health insurer" (premiums OR earnings OR merger OR "medical costs")') },
    ],
  },
];

export const findPack = (id: string) => STARTER_PACKS.find((p) => p.id === id);
export const googleNewsUrl = gnews;

/** Packs with a "loaded" flag: loaded = every one of its competitor-specific sources already exists. */
export function packsWithStatus(existingSourceUrls: Set<string>) {
  return STARTER_PACKS.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    competitors: p.competitors.length,
    loaded: p.competitors.every((c) => existingSourceUrls.has(gnews(c.query))),
  }));
}
