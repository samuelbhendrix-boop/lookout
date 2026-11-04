# Changelog

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
