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
    name: "Massachusetts commercial health plans",
    description: "Local plans, nationals operating in MA, and state market/regulatory news. Delete your own company after loading.",
    competitors: [
      {
        name: "Blue Cross Blue Shield of Massachusetts",
        aliases: ["bcbsma", "blue cross blue shield of massachusetts", "blue cross massachusetts"],
        tier: 1,
        website: "https://www.bluecrossma.org",
        query: '"Blue Cross Blue Shield of Massachusetts" OR "BCBSMA"',
      },
      {
        name: "Point32Health",
        aliases: ["point32health", "harvard pilgrim", "harvard pilgrim health care", "tufts health plan"],
        tier: 1,
        website: "https://www.point32health.org",
        query: '"Point32Health" OR "Harvard Pilgrim" OR "Tufts Health Plan"',
      },
      {
        name: "Mass General Brigham Health Plan",
        aliases: ["mass general brigham health plan", "allways health partners", "mgb health plan"],
        tier: 1,
        website: "https://www.massgeneralbrighamhealthplan.org",
        query: '"Mass General Brigham Health Plan" OR "AllWays Health Partners"',
      },
      {
        name: "Fallon Health",
        aliases: ["fallon health", "fallon community health plan"],
        tier: 2,
        website: "https://www.fallonhealth.org",
        query: '"Fallon Health"',
      },
      {
        name: "Health New England",
        aliases: ["health new england"],
        tier: 2,
        website: "https://healthnewengland.org",
        query: '"Health New England" insurer OR plan',
      },
      {
        name: "WellSense Health Plan",
        aliases: ["wellsense", "bmc healthnet"],
        tier: 2,
        website: "https://www.wellsense.org",
        query: '"WellSense" OR "BMC HealthNet"',
      },
      {
        name: "UnitedHealthcare",
        aliases: ["unitedhealthcare", "united healthcare", "unitedhealth", "unitedhealth group", "uhc", "optum"],
        tier: 1,
        website: "https://www.uhc.com",
        query: '"UnitedHealthcare" (Massachusetts OR "New England" OR employer OR commercial)',
      },
      {
        name: "Aetna",
        aliases: ["aetna", "cvs health"],
        tier: 2,
        website: "https://www.aetna.com",
        query: '"Aetna" (Massachusetts OR "New England" OR employer OR commercial)',
      },
      {
        name: "Cigna",
        aliases: ["cigna", "the cigna group", "evernorth"],
        tier: 2,
        website: "https://www.cigna.com",
        query: '"Cigna" (Massachusetts OR "New England" OR employer OR commercial)',
      },
    ],
    marketSources: [
      { name: "Healthcare Dive", url: "https://www.healthcaredive.com/feeds/news/" },
      { name: "MA health insurance news", url: gnews('Massachusetts "health insurance" OR "health plan" premiums OR rates') },
      { name: "MA Division of Insurance", url: gnews('"Massachusetts Division of Insurance" health') },
      { name: "MA Health Connector", url: gnews('"Massachusetts Health Connector"') },
      { name: "MA Health Policy Commission", url: gnews('"Health Policy Commission" Massachusetts') },
    ],
  },
];

export const findPack = (id: string) => STARTER_PACKS.find((p) => p.id === id);
export const googleNewsUrl = gnews;
