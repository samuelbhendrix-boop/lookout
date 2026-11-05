# Changelog

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
