# Changelog

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
