/**
 * Where each carrier markets its commercial (employer and individual) medical products. The crawler starts at the
 * roots, stays on the listed hosts, follows links whose URL looks like product, plan, network or buyer material, and
 * keeps PDFs that look like plan summaries, brochures or benefit guides. Member-servicing, provider, Medicare and
 * Medicaid pages are skipped: the point is how the products are structured and sold.
 *
 * `match` is tested against the competitor's name, so the config works in any workspace.
 */
export type ProductSite = {
  key: string;
  label: string;
  match: RegExp;
  roots: string[];
  hosts: string[];
  /** Extra path filter: a URL must match this to be followed (besides the roots). */
  include?: RegExp;
  exclude?: RegExp;
  maxPages?: number;
  maxPdfs?: number;
  /** Why it isn't crawled, when it isn't. */
  skip?: string;
};

export const SITES: ProductSite[] = [
  {
    key: "bcbsma", label: "Blue Cross Blue Shield of Massachusetts", match: /blue cross blue shield of massachusetts|bcbsma/i,
    roots: ["https://employer.bluecrossma.com/employers-plan-and-products", "https://employer.bluecrossma.com/medical-insurance", "https://employer.bluecrossma.com/forms-documents/marketing-materials", "https://employer.bluecrossma.com/municipal-blue/products", "https://www.bluecrossma.org/myblue/learn-and-save/plans-and-benefits/medical", "https://www.bluecrossma.org/myblue/learn-and-save/plans-and-benefits/deductible-plans", "https://www.bluecrossma.org/myblue/learn-and-save/plans-and-benefits/health-connector-plans"],
    hosts: ["www.bluecrossma.org", "employer.bluecrossma.com", "home.bluecrossma.com"],
    include: /medical-insurance|plan-and-products|marketing-materials|municipal-blue|plan-updates|plans-and-benefits\/(medical|deductible|health-connector)/i,
    exclude: /dental|vision|pharmacy|life-disability|manage-your-account|member-tools|newsletter|webinars|iai-archive|regulatory|quote-form/i,
  },
  {
    key: "point32", label: "Point32Health (Harvard Pilgrim, Tufts Health Plan)", match: /point32|harvard pilgrim|tufts health/i,
    roots: ["https://www.harvardpilgrim.org/employer", "https://www.harvardpilgrim.org/broker", "https://www.harvardpilgrim.org/enroll/individual-and-family", "https://www.harvardpilgrim.org/enroll/employer-sponsored", "https://www.harvardpilgrim.org/employer/works-better", "https://www.tuftshealthplan.com/employer", "https://www.tuftshealthplan.com/broker", "https://www.tuftshealthplan.com/plans-benefits/explore-our-plans/overview", "https://www.tuftshealthplan.com/member/employer-individual-or-family-plans"],
    hosts: ["www.harvardpilgrim.org", "www.tuftshealthplan.com", "tuftshealthplan.com"],
    include: /employer|broker|enroll|plan|product|network|virtual|tier|value|select|individual|famil|small|large|works-better/i,
    exclude: /medicare|senior|together|one-care|direct-plans|ritogether|unify|hphconnect|about-employer-account/i,
    maxPages: 30,
  },
  {
    key: "mgb", label: "Mass General Brigham Health Plan", match: /mass general brigham|allways/i,
    roots: ["https://massgeneralbrighamhealthplan.org/plans", "https://massgeneralbrighamhealthplan.org/plans/small-business", "https://massgeneralbrighamhealthplan.org/plans/small-group", "https://massgeneralbrighamhealthplan.org/plans/large-group", "https://massgeneralbrighamhealthplan.org/plans/individuals", "https://massgeneralbrighamhealthplan.org/employers", "https://massgeneralbrighamhealthplan.org/brokers"],
    hosts: ["massgeneralbrighamhealthplan.org", "www.massgeneralbrighamhealthplan.org"],
    include: /plans|employer|broker|network|virtual|individual|small|large/i,
    exclude: /mgb-aco|masshealth|medicare|senior/i,
  },
  {
    key: "bcbsri", label: "Blue Cross & Blue Shield of Rhode Island", match: /blue cross (&|and) blue shield of rhode island|bcbsri/i,
    roots: ["https://www.bcbsri.com/employers", "https://www.bcbsri.com/employers/plans/types", "https://www.bcbsri.com/employers/plans/features", "https://www.bcbsri.com/individual/shop", "https://www.bcbsri.com/individual/shop/medical/2027", "https://www.bcbsri.com/individual/choose/network", "https://www.bcbsri.com/brokers"],
    hosts: ["www.bcbsri.com"],
    include: /employers\/(plans|programs)|individual\/(shop|choose)|brokers|plan|network/i,
    exclude: /member\/|BCBSRIWeb|medicare/i,
  },
  {
    key: "anthem", label: "Anthem (Elevance Health)", match: /anthem|elevance/i,
    roots: ["https://www.anthem.com/employer/small-business-health-insurance/medical-insurance", "https://www.anthem.com/employer/large-group-health-insurance/medical-insurance", "https://www.anthem.com/employer/national-health-insurance-plans", "https://www.anthem.com/individual-and-family/health-insurance", "https://www.anthem.com/producer/products", "https://www.anthem.com/employer/the-benefits-guide"],
    hosts: ["www.anthem.com"],
    include: /employer|individual-and-family\/health|producer\/products|ct|maine|new-hampshire|network|plan/i,
    exclude: /medicare|medicaid|dental|vision|supplemental|travel|\/es\/|the-benefits-guide\/|behavioral|wellness|pharmacy|students|federal-employee|request-a-quote|employee-benefits-programs/i,
  },
  {
    key: "uhc", label: "UnitedHealthcare", match: /unitedhealth|uhc\b/i,
    roots: ["https://www.uhc.com/employer/products-solutions/medical-plans", "https://www.uhc.com/employer/small-business", "https://www.uhc.com/employer/large-organizations", "https://www.uhc.com/employer/health-plan-value", "https://www.uhc.com/individual-family"],
    hosts: ["www.uhc.com"],
    include: /employer\/(products-solutions|small-business|large-organizations|health-plan-value)|medical-plans|individual-family|surest|nexus|doctors-plan|virtual|navigate|choice|core|level-funded|harvard/i,
    exclude: /medicare|medicaid|community-plan|dental|vision|news-strategies|\/es\/|\/shop\/(?!(ma|ct|ri|nh|me|vt)\b)[a-z]{2}\b|\/shop\/congress|\/en\/shop\/(?!(ma|ct|ri|nh|me|vt)\/)[a-z]{2}\/|retiree|federal-government|naviguard|specialty|pharmacy|behavioral|maternity|wellness|uhc-hub|benefits-administration|health-equity/i,
  },
  {
    key: "aetna", label: "Aetna", match: /aetna/i,
    roots: ["https://www.aetna.com/employers-organizations.html", "https://www.aetna.com/solutions/segment/small-business.html", "https://www.aetna.com/solutions/segment/large-group-business.html", "https://www.aetna.com/health-insurance-plans.html", "https://www.aetna.com/individuals-families/health-insurance-through-work/network.html"],
    hosts: ["www.aetna.com"],
    include: /employers-organizations|solutions\/segment|health-insurance-plans|network|funding|level|whole-health|choice|open-access|virtual|plan/i,
    exclude: /medicare|medicaid|dental|vision|supplemental|international|retiree|find-a-medication|pharmacy|crisis|lgbtq|glp1|gcit/i,
  },
  {
    key: "cigna", label: "Cigna Healthcare", match: /cigna/i,
    roots: ["https://www.cigna.com/employers/medical-plans", "https://www.cigna.com/employers/small-business", "https://www.cigna.com/employers/small-to-midsize-business", "https://www.cigna.com/employers/midsize-to-large-business", "https://www.cigna.com/employers/large-business", "https://www.cigna.com/employers/cost-control"],
    hosts: ["www.cigna.com"],
    include: /employers\/(medical-plans|small|midsize|large|cost-control|why-cigna)|network|localplus|oap|open-access|level-funded|surefit|connect|virtual|plan/i,
    exclude: /medicare|medicaid|dental|vision|\/es-us\/|healthwise|knowledge-center/i,
  },
  {
    key: "hne", label: "Health New England", match: /health new england/i,
    roots: ["https://healthnewengland.org/plans", "https://healthnewengland.org/employer", "https://healthnewengland.org/broker", "https://healthnewengland.org/plans/individual-and-family", "https://healthnewengland.org/select-plan-type"],
    hosts: ["healthnewengland.org", "www.healthnewengland.org"],
    include: /plan|employer|broker|network|individual|small|large|virtual/i,
    exclude: /medicare|masshealth|be-healthy|medicaid/i,
  },
  {
    key: "fallon", label: "Fallon Health", match: /fallon/i,
    roots: ["https://www.fallonhealth.org/en/employers", "https://www.fallonhealth.org/en/brokers", "https://www.fallonhealth.org/find-insurance/individuals-families"],
    hosts: ["www.fallonhealth.org"],
    include: /employer|broker|individual|plan|network|commercial/i,
    exclude: /medicare|masshealth|nhc|navicare|summit|pace|medicaid|pharmacy|clinical|authorization|abortion|maternity|oh-baby|smoking|glp1|opioid|requestkit|become-a-broker|retiree|resources|tools|naturally-well|it-fits/i,
  },
  {
    key: "wellsense", label: "WellSense Health Plan", match: /wellsense|boston medical center health plan/i,
    roots: ["https://www.wellsense.org/plans/individual-and-family", "https://www.wellsense.org/plans/individual-and-family/ma/clarity-plans", "https://www.wellsense.org/plans/individual-and-family/nh/clarity-plans", "https://www.wellsense.org/about-us/brokers"],
    hosts: ["www.wellsense.org"],
    include: /individual-and-family|clarity|broker|employer|small|plan/i,
    exclude: /medicare|masshealth|medicaid|senior|members\//i,
  },
  {
    key: "cho", label: "Community Health Options", match: /community health options/i,
    roots: ["https://www.healthoptions.org/members/explore-plans", "https://www.healthoptions.org/employers/small-group-plans", "https://www.healthoptions.org/employers/large-group-plans", "https://www.healthoptions.org/brokers/individual-family", "https://www.healthoptions.org/employers/virtual-care", "https://www.healthoptions.org/brokers/our-network"],
    hosts: ["www.healthoptions.org"],
    include: /explore-plans|employers|brokers|plan|network|virtual|individual|small|large/i,
    exclude: /blog|get-appointed|frequently|contact/i,
  },
  {
    key: "nhpri", label: "Neighborhood Health Plan of Rhode Island", match: /neighborhood health plan/i,
    roots: ["https://www.nhpri.org/individual-family-plans", "https://www.nhpri.org/"],
    hosts: ["www.nhpri.org"],
    include: /individual-family|small-business|employer|commercial|plan-?summary|shop/i,
    exclude: /rite-?care|medicaid|integrity|unity|medicare/i,
    maxPages: 15,
  },
  {
    key: "ambetter", label: "Ambetter (Centene)", match: /centene|ambetter/i,
    roots: ["https://www.ambetterhealth.com/health-plans.html", "https://www.ambetterhealth.com/health-plans/what-is-ambetter.html", "https://www.ambetterhealth.com/en/nh/"],
    hosts: ["www.ambetterhealth.com"],
    include: /health-plans|\/nh\/|virtual|ways-to-save|what-is/i,
    exclude: /knowledge-center|broker-portal|\/es\//i,
    maxPages: 20,
  },
  {
    key: "taro", label: "Taro Health (Mending)", match: /taro|mending/i,
    roots: ["https://www.mending.com/", "https://www.mending.com/benefit-leaders-health-plans"],
    hosts: ["www.mending.com", "mending.com", "www.tarohealth.com"],
    maxPages: 20,
  },
  {
    key: "oscar", label: "Oscar Health", match: /oscar/i,
    roots: ["https://www.hioscar.com/get-coverage", "https://www.hioscar.com/get-coverage/oscar-virtual-care", "https://www.hioscar.com/for-employers", "https://www.hioscar.com/for-employers/choice-employers", "https://www.hioscar.com/brokers/plans"],
    hosts: ["www.hioscar.com"],
    include: /get-coverage|for-employers|brokers\/plans|virtual|choice|ichra/i,
    exclude: /blog|faqs|events|training|regional-sales|medicare/i,
    maxPages: 20,
  },
  { key: "humana", label: "Humana", match: /humana/i, roots: [], hosts: [], skip: "Left the employer group commercial market in 2025; no New England commercial products." },
  { key: "kaiser", label: "Kaiser Permanente", match: /kaiser/i, roots: [], hosts: [], skip: "No New England commercial products." },
  { key: "molina", label: "Molina Healthcare", match: /molina/i, roots: [], hosts: [], skip: "No New England commercial products." },
  { key: "hcsc", label: "HCSC", match: /hcsc|health care service corp/i, roots: [], hosts: [], skip: "No New England commercial products." },
];

export const siteFor = (name: string) => SITES.find((s) => s.match.test(name)) ?? null;
