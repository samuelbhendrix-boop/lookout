# Changelog

## 0.21.1 — 2026-11-09
- Market share shows the selected state and segment only: one full-width bar summing to 100%, with every carrier's exact share and change listed under it, and the cross-check warning when that total disagrees with an independent count.
- **Share over time**: a 100% bar per year (2020–2024) and a share trend line for every carrier that held 3%+.

## 0.21.0 — 2026-11-09
- **Home is about competitors' pricing, networks, products and sales**, in charts: premium per member per month 2020–2024 by competitor and market (large group, small group, individual); filed ACA rate increases by plan year; cheapest silver premium and exchange plan counts 2024–2027; hospital prices as a multiple of Medicare; negotiated-rate and network moves; accounts won and lost; renewals in play; and only product, pricing and network news.
- **Updates replaces Briefing, Feed and Changes**: one feed of competitor news and data-detected changes (your competitors, with triage) or every carrier's changes (whole market), filtered by pricing, network, product, sales or news, time window, competitor, state and status, with the week's top five on top. Old links redirect. Carriers you don't track moved to Competitors.
- **Market share at a glance**: one bar per state for each segment, summing to 100%, competitors colored. **Cross-check** of every state/segment total against an independent count (MA CHIA, Maine BOI, NH and RI regulators, ACA rate filings): 11 of 15 within 15%; the four gaps are explained (BCBSMA's MA large-group classification, Harvard Pilgrim's Maine small group, filing timing, OHIC scope).
- **Every table is sortable** (click a header) **and filterable** (search box on tables with 6+ rows).
- Competitor colors are fixed app-wide: the eight largest by New England lives get the eight palette colors; the rest are gray "other", never a repeated color.

## 0.20.0 — 2026-11-09
- **Monthly MRF extract, free on GitHub Actions.** Every reachable carrier rate file (about 130 files, 38 GB compressed a month: Cigna, Aetna, UHC, Anthem CT/ME/NH, BCBSRI, BCBSVT, Harvard Pilgrim, Tufts, MGB, Fallon, NHPRI, CHO) is streamed by a new Go extractor (`tools/mrfx`, ~150 MB/s) in 20 parallel jobs. It keeps every New England provider (500K NPIs from NPPES, plus known New England TINs), physician and facility, for 2,567 services: the top 1,800 by Medicare spend (97% of it) and every DRG. Output is Parquet per carrier on the GitHub release `mrf-YYYY-MM`, plus a market summary.
- **Rate explorer** (Market Review → Rate explorer): what each carrier pays for any of those services by state and setting (physician, hospital outpatient, inpatient), with low/median/high and provider counts; a price index per carrier (100 = typical); search by code or name; any code across every state. The app checks daily for a new extract.
- **Manual files for browser-only sites.** Hospital price files and carrier files that refuse automated downloads can be added by hand to the `manual-mrf` release (file upload or a link in `links.txt`); the hospital import and the extract pick them up. A saved BCBSMA index unlocks BCBSMA HMO Blue and Anthem NH HMO Blue New England Choice. Guide: docs/MANUAL-MRF.md and the Manual MRF Extraction QRG doc.

## 0.19.0 — 2026-11-09
- **GIC large-group benchmark.** The MA Group Insurance Commission's eight non-Medicare plans (Harvard Pilgrim, Wellpoint/Elevance, MGB Health Plan, Health New England), FY2026 and FY2027: full monthly cost per subscriber (individual and family), increase, projected subscribers, network tier, and the complete in-network benefit design side by side (deductible, out-of-pocket max, PCP/specialist/ER/inpatient/surgery/imaging copays with tiers, Rx). By-carrier share and enrollment-weighted increase; design changes year over year. On Products → Large group (MA) and on each matching competitor's products page.
- `scripts/build-gic.ts` rebuilds `data/gic/gic-fyYYYY.json` from GIC's benefit guide and rate-vote slides each spring (fails loudly if the layout changes).

## 0.18.0 — 2026-11-09
- **Large group in Products.** New "Large group" market on /products for each state: fully insured lives, share and change, self-insured members (MA, NH), premium and claims PMPM and loss ratio (CMS MLR); what employers pay per covered person by group size, renewal increase for employers staying with the same carrier, broker pay and HMO share (Form 5500 Schedule A); product mix by HMO/PPO/POS/EPO (CHIA); RI OHIC requested vs approved rates with trend and retention; Maine admin and underwriting margin.
- **Each competitor's large group** on its products page: the same measures by state, and its **product line-up** read from the plan names in its transparency index (e.g. MGB: Complete HMO, Complete PPO Plus, Choice Easy Tier HMO, Allies HMO, with deductible ranges, HSA, tiered and limited networks).

## 0.17.0 — 2026-11-09
- Plan directories: dropped issuer 72953, which the CMS list files under NH but is Renaissance, a dental-only carrier; physician counts now include only clinicians with a New England practice address.
- **Home page** (logo and first sidebar item; where sign-in lands): greeting, six KPIs (news this week vs last, major items, changes detected from data, accounts in play with covered lives, competitors tracked and quiet, source health and data age), top things that moved, top stories, 30-day activity, most active competitors, renewals in play. No more than two items per competitor in each list.
- **Sidebar shows your name**, not your email; it opens Your account.
- **22 recommended news sources** added to every workspace once (deleted ones stay deleted): Becker's Payer Issues, STAT, Managed Healthcare Executive, Georgetown CHIR, AHIP, CommonWealth Beacon, Boston Globe health care, Health Care For All, CT Mirror, NH Bulletin, RI Current, VTDigger, Maine Morning Star, MA DOI, RI OHIC and VT DFR pages; Fierce Healthcare, Modern Healthcare, Axios, WBUR and Boston Business Journal through Google News because their sites block automated readers. The Sources page lists any you don't have, with one-click Add.
- Briefing and Home drop stock-chatter headlines (price targets, "stock heads into earnings", Simply Wall St, TradingView and the like).

## 0.16.0 — 2026-11-09
- **Renamed to Payersight.** New sunrise mark and wordmark in the sidebar and sign-in pages, favicon and home-screen icon, amber brand accent (#F2A33A), page titles, export file names and the crawler's User-Agent (PayersightBot, same contact URL). The GitHub repo, Render service and database keep the name "lookout" so deploys and data are untouched.

## 0.15.0 — 2026-11-09
- **Web pages as sources:** add any newsroom, press-release list, regulator notice page or product/policy page. Lookout uses the feed the page advertises if it has one; otherwise it reports headlines that weren't there on the last check; on a page that isn't a list, it reports what text was added or removed. The first check records a baseline. Pages built entirely by JavaScript, or that refuse automated visits, are reported as unreadable rather than worked around.
- **Sidebar regrouped:** Market Review (Briefing, Feed, Competitors, Products, Market, Rates, Leverage, Networks, Changes), Sales (In play, Employers), Settings (Workspace, Your account, Sources, Alerts). Groups collapse and remember it.
- The workspace name links to workspace settings, where admins can rename it and set an icon (image or emoji). Your email links to **Your account**: display name, icon, password change (signs out your other sessions).

## 0.14.0 — 2026-11-09
- **Provider networks and formularies per plan** (from insurers' machine-readable directory and formulary files listed in CMS's MR-PUF): in-network New England hospitals (grouped into distinct networks, with the hospital list), physicians, primary care physicians, share accepting new patients, formulary size, prior-authorization and step-therapy rates, and coverage of 14 high-cost drug groups (GLP-1s for weight loss vs diabetes, adalimumab, Dupixent, Stelara, Skyrizi, Rinvoq, Eliquis, SGLT2s, Entresto, Biktarvy, Trikafta, insulin glargine, PCSK9s). On each competitor's products page and the market products page. Federal-platform plans only (New Hampshire: Anthem, Harvard Pilgrim, Ambetter, Matthew Thornton); WellSense's files are on a port we can't reach.
- **Briefing shows every competitor:** quiet competitors get a card with their last activity instead of one line, and a new list names carriers with 2,000+ covered lives in your states that you don't track (from NAIC financials), with a one-click Track.
- ConnectiCare, MVP, Ambetter and Matthew Thornton recognised as carriers in filings.

## 0.13.2 — 2026-11-09
- Hospital files: header spellings with spaces ("Code |1| Type", "standard_charge | negotiated_dollar") are read; percent-of-charges contracts get a dollar amount (gross charge × contracted %, else the median allowed); fractional percentages handled. Baystate and Care New England now parse.
- Mostly-Medicaid carriers (WellSense, Fallon, NHPRI, MGB) count only plans named as commercial, so MassHealth and RIte Care rates aren't read as commercial prices; Tufts Public Plans excluded.
- Leverage cross-check labelled agree / close / don't match.
- Hospital domains corrected (Elliot, Care New England); two dead ones removed.

## 0.13.1 — 2026-11-09
- **Blue Cross snapshots refresh automatically:** 18 of 20 Blue networks (Anthem CT/ME/NH, BCBSRI, BCBSVT) are found each month in Anthem's public index, streamed; only BCBSMA HMO Blue and Anthem NH HMO Blue New England Choice still need BCBSMA's browser-only index.
- **Import order:** never-imported and quick datasets go first (plan designs, filings), hours-long ones (hospital files) last, so new features don't wait behind slow refreshes.

## 0.13.0 — 2026-11-09
- **Price leverage page:** what each carrier pays each hospital as a multiple of that hospital's own Medicare rate, compared on the services 2+ carriers price there. By carrier: median multiple, how it compares with other carriers at the same hospitals, and where it has the best and worst deal. Carriers whose files publish one network-wide fee schedule (Fallon) are flagged and kept out of rankings.
- **Hospitals' own price files:** reads each hospital's cms-hpt.txt and standard-charges file (CMS template v2/v3, JSON or CSV, tall or wide, zipped or not) for ~50 New England hospital systems, keeps commercial basket prices by payer and product. Fills BCBSMA's PPO and WellSense, splits carriers into HMO/PPO/POS, and cross-checks hospital-published rates against carriers' own files.
- **Self-funded administration (Form 5500 Schedule C):** names the claims administrator of self-funded plans and what it was paid. Median fee per participant per month by administrator; each competitor's self-funded employers on its products page; ASO accounts join Accounts in play (flagged when paying 25%+ above the administrator's median); administrators shown on Employers.
- **Network head-to-head:** pick two carriers on Networks to see the hospitals only one of them prices; networks under half the state's hospitals are marked narrow.
- **"Data as of" line** on every data page: latest period and last refresh per source, amber when stale or failed.

## 0.12.1 — 2026-11-09
- **Imports survive deploys.** A running import now heartbeats every 30 s. An import whose server was replaced or killed is re-queued within 3 minutes (it used to block every other import for an hour, then repeat); after 5 interruptions it is marked failed with the reason. On shutdown the old server hands its import straight back to the queue.
- Imports run strictly one at a time.
- Market changes (accounts won/lost, filings, rate changes) are detected from already-imported data on servers that imported before 0.10, so the Changes page, Briefing and alerts aren't empty.
- System status shows server memory against the plan's limit and the import in progress with its heartbeat.

## 0.12.0 — 2026-11-09
- **Commercial products per competitor** (`/competitors/:id/products`): for each state and market, every exchange plan with premium at age 40 (range across rating areas), deductible, out-of-pocket max, coinsurance, actuarial value, network, service area, HSA eligibility, tiered/out-of-network/referral flags, and the standard SBC cost examples (baby, diabetes, fracture); copays per service in New Hampshire. Enrollment and rate change from the plan's rate filing.
- **Positioning:** cheapest plan per metal and its rank among all carriers, gap to the market's cheapest, deductible/OOP/SBC vs market median; who holds the lowest and benchmark (second-lowest) silver plan in every rating area.
- **Benefits beyond the essentials:** adult dental and vision, hearing aids, acupuncture, chiropractic, bariatric surgery, infertility, weight-loss programs and more — this carrier vs everyone else, by carrier.
- **What changed from last year:** new and discontinued plans (renumbered plans matched by name), premium change on continuing plans vs market, cheapest-by-metal trend, deductible and out-of-pocket changes, networks added or retired, benefit coverage shifts.
- **Full line-up from rate filings** including off-exchange products, with share of the state market's filed enrollment; group and self-funded plan names from the carrier's transparency index.
- **Products page** (`/products`): all carriers in a state and market side by side — cheapest plan by metal, networks, HSA, benchmark holders by rating area, every plan in a metal cheapest-first, benefits matrix.
- New data: CMS QHP public use files 2024–2026 for MA, CT, RI, VT, ME (state-based exchanges) and 2024–2027 for NH (federal platform), imported monthly.

## 0.11.0 — 2026-11-09
- **Briefing (new home page):** the week's top five across competitors, ranked, each with a one-line "why it matters"; then up to three items per competitor. News and data-detected changes together; stock quotes and analyst ratings filtered out. Weekly digests carry the same why-it-matters lines.
- **Accounts in play:** employer groups renewing in the next 60–365 days, ranked by evidence the account can be won — premium per person up, claims running hot or cold against premium, a new broker, and what the carrier just did (rate increases, lost hospitals). Filter by state and competitor; CSV export.
- **Broker league table:** who moved accounts between carriers, how many people, from whom to whom, and each broker's book.
- **Rate-change alerts live now:** UnitedHealthcare's October file seeds last month's history, so November's changes are detected today (36 provider rate changes, 1 hospital no longer priced) instead of in December.
- **System status page** (admins): worker, stuck jobs, failed imports, rate history, memory — the screen to check when a page is empty. Networks rebuilds its data automatically and shows progress.
- Alerts now fire on newly *detected* changes (an account switch filed months after the plan year used to be treated as old news and never alerted).
- Refreshed snapshots are imported on deploy rather than at the next monthly cycle.

## 0.10.0 — 2026-11-09
- **Changes page:** what moved, detected from the data — employers switching carriers (Form 5500 year over year, materiality-filtered: 701 New England account changes), ACA rate filings (132 New England filings with enrollment-weighted rate changes), month-over-month negotiated-rate changes and network adds/drops. Filter by kind, state, carrier, competitor or "major only".
- **Changes feed the alerts:** every change becomes a signal for the matching competitor (hourly sync), so existing alert rules and digests fire on them; back-history is added silently. Competitor profiles show recent market changes.
- **Rate history:** each month's carrier × provider × service medians are kept for 13 months; the Rates page marks month-over-month moves (▲▼).
- **Networks page:** map and hospital × carrier matrix of which New England hospitals each carrier's rate files price (inpatient vs outpatient-only), network breadth per state, single-carrier hospitals, unmatched hospitals disclosed.
- **Single sign-on** (OIDC: Entra ID, Google Workspace, Okta) with PKCE, JWKS-verified ID tokens, domain allow-list and default-workspace provisioning.
- **Backups:** owners can download a workspace JSON backup; Render point-in-time recovery documented.
- **Monthly snapshot refresh:** `npm run mrf:refresh` re-finds and re-reduces the Cigna, Aetna and UnitedHealthcare snapshots from the carriers' own indexes (the Blues need a browser-saved table of contents); the Rates page flags snapshots older than 45 days.
- Render blueprint moves to the Standard instance (1 CPU, 2 GB).

## 0.9.0 — 2026-11-05
- **Every major New England carrier's negotiated rates:** Blue Cross Blue Shield of Massachusetts (HMO Blue), Anthem (NH, ME, CT), Blue Cross RI, Blue Cross VT, Cigna (OAP, LocalPlus, PPO, New England GPPO, Maine HMO, RI GPPO), Aetna, UnitedHealthcare, Tufts Health Direct, Fallon, Neighborhood Health Plan of RI and Maine Community Health Options join MGB and Harvard Pilgrim. Every Harvard Pilgrim and MGB network is now reduced, not just the largest two.
- **Rates page:** one column per carrier (networks combined, per-network values on hover), state filter, provider state shown; CSV export one row per carrier network.
- Multi-part rate files merge exactly; identical networks are stored once; APC-priced hospital outpatient contracts map to the procedures in each APC.
- Medicare benchmarks use the provider's own state (all New England fee-schedule localities and state wage indexes); provider names and states fall back to the IRS exempt-organization register; strict automatic hospital matching extends the reviewed list.
- Exclusions now name source-side problems too: BCBSMA's own transparency site and WellSense's portal refuse automated clients; Community Health Options' file hasn't been updated since December 2025; NHPRI publishes no professional rates.
- Rate imports run as one job per carrier and resume in fresh processes at a memory budget, so a 51-network carrier fits the 512 MB server; secondary networks are stored as deltas (~5× fewer rows).
- Outlier prices (>10× or <0.2× Medicare — bundled case rates or file errors) are flagged and excluded from comparisons; carriers that publish no dollar prices for a whole category are listed.
- ~160 New England hospitals now carry hospital-specific Medicare rates (reviewed + strict auto-matching, NPPES and IRS names); critical-access and VA hospitals are explained rather than compared.

## 0.8.0 — 2026-11-04
- **% of Medicare** on every negotiated rate, network distribution and carrier card, from CMS's 2026 physician, outpatient-hospital and lab fee schedules and the FY2027 inpatient rule. Inpatient comparisons use each hospital's own Medicare rate (wage index, teaching and safety-net add-ons) through a reviewed list of 64 New England hospital TINs.
- **What's not included:** the Rates page lists every carrier without data, every file found but not reduced (68 this month, with reasons), prices dropped inside reduced files, comparisons excluded from the index, and services/hospitals with no Medicare comparison. Feed, Market, Employers, Transparency and competitor profiles gained "Not included" panels.
- CSV export adds Medicare amount, % of Medicare and method. Basket: MS-DRG 247 (retired) → 322.

## 0.7.0 — 2026-11-04
- **Negotiated rates:** new Rates page with what Mass General Brigham, Harvard Pilgrim and UnitedHealthcare pay each New England hospital and large group for ~50 benchmark services (office/ED visits, imaging, labs, procedures, surgery, maternity, inpatient APR-/MS-DRGs). Provider × carrier comparison, network-wide distributions, CSV export, monthly refresh.
- **Carrier price index:** each carrier's rate vs peers for the same service at the same provider, overall and by category — on the Rates page and competitor profiles.
- **Large-file reducer:** byte-level streaming scanner turns 2–300 GB rate files into a few thousand rows at ~300 MB/s in ~300 MB of memory; `npm run mrf:reduce -- <url|file> out.csv` for any carrier's file. UnitedHealthcare's 303 GB Options PPO file ships as a 418 KB snapshot.
- Lower native memory use for all imports (`MALLOC_ARENA_MAX`).

## 0.6.0 — 2026-11-04
- **Transparency in Coverage files:** reads payer machine-readable tables of contents monthly (Cigna, UnitedHealthcare, Harvard Pilgrim, Mass General Brigham automated; 8 regional/national carriers linked). Matches EINs to New England employers to name the administrator of self-funded plans (Cigna 320, UHC 87, Harvard Pilgrim 28 employers).
- New Transparency page with per-carrier file inventory (plans, index files, rate-file volume); Employers page shows TiC administrators (TPA badge) and filters by them; competitor profiles get a plan catalog from the carrier's own index, including large-group products.
- MA products labeled "Merged" market (MA files individual + small group together).

## 0.5.0 — 2026-11-04
- **Employers (DOL Form 5500 + Schedule A):** every New England employer health plan with 100+ participants — carrier, persons covered, premium, claims, broker and commissions, renewal month, insured vs self-funded vs mixed. Plan years 2023–2025, refreshed monthly from DOL. New Employers page with filters and CSV export; "Employer book" on competitor profiles (largest employers, top brokers, renewal calendar).
- Curated carrier-name patterns now live in code and improve each release (saved copies cleared); broader BCBSMA and UnitedHealthcare/Optum matching.

## 0.4.0 — 2026-11-04
- **Large group, including self-insured:** MA CHIA enrollment by carrier × fully/self-insured × group size (quarterly 2021–2025, auto-imported); Maine carrier financials with admin and underwriting gain (2023–2025); Rhode Island large-group requested vs approved rates with trend/retention assumptions (2026–2027); NH large-group shares incl. self-insured (2020–2022).
- New "Large group" section on competitor profiles and large-group panels on the Market page; SERFF search links per state.
- Snapshot data is test-guarded (balances, totals, mapping uniqueness).

## 0.3.1 — 2026-11-04
- **Fresher feed:** articles older than 30 days are never ingested (`MAX_ARTICLE_AGE_DAYS`), Google News queries ask for recent results only, and the feed is ordered by publication date rather than import time.
- **More relevant feed:** items from a competitor's own news feed must actually name that competitor; general market items about no tracked competitor and with no clear type are archived. Filtered items are tagged `auto-filtered` and stay searchable under Status → archived.
- **One-time cleanup:** existing untriaged items that were old when fetched or off-topic are archived (your triaged items are untouched); broader aliases for Aetna/CVS, Point32Health, BCBSMA, MGB and Neighborhood Health.

## 0.3.0 — 2026-11-04
- **Competitor profiles:** performance by segment and year (covered lives, premium, loss ratio, PMPM, broker comp), every individual/small-group product and plan with rate changes and enrollment, rate filings with SERFF numbers, and the legal entities behind each competitor.
- **Market page:** fully insured market share by state × segment × year, YoY movement, and ACA rate actions for the latest plan year.
- **Public data pipeline:** CMS Unified Rate Review and Medical Loss Ratio files imported automatically (child process, streaming, monthly refresh).
- **Starter packs:** NH, ME, RI, National; curated filing-name matches for every carrier.
- **Feeds:** polite per-host fetching, Bing News fallback on Google throttling, retry button, malformed-feed tolerance; worker is a continuous pool with alerts prioritized.

## 0.2.0 — 2026-11-04
- **Story clustering:** coverage of the same event from multiple outlets collapses to one feed row ("+N outlets"); instant alerts fire once per story; "split out" undoes a wrong merge.
- **Weekly digest** alert mode: top 15 matching stories grouped by competitor, to any Slack-compatible webhook.
- **Invite links** (role, expiry, use cap, revoke) and a **workspace switcher** for people in more than one workspace.
- **CSV export** of any filtered feed view, protected against spreadsheet formula injection.
- **SSRF guard** on feed and webhook URLs, checked at creation and on every fetch/redirect; 5 MB body cap.
- **Tests:** 24 unit tests; 35-check end-to-end smoke test; GitHub Actions CI on Postgres 16.
- Fixes: API signal detail now returns coverage; stats count stories, not outlet copies; system font stack (was falling back to serif); mobile header wrapping.

## 0.1.0 — 2026-11-04
Initial MVP: workspaces and roles, competitors, RSS sources and worker, classification, dedupe, triage feed, comments, instant Slack alerts.
