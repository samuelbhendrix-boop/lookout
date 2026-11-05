# Lookout

Competitive-intelligence signal tracker. Feeds in → attributed, classified, deduped signals, grouped into stories → team triage → Slack alerts and weekly digests.

Next.js 15 (App Router) · TypeScript · PostgreSQL · Prisma · Tailwind. Architecture, schema and API: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Deploy (one click)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/samuelbhendrix-boop/lookout)

Creates one always-on service (web + worker, $7/mo) and a Postgres database ($6/mo) from `render.yaml`. Migrations run on boot. The **first account you create becomes the owner**; after that, sign-up is invite-only (Settings → Invite links). Set `OPEN_SIGNUP=true` to let anyone create a workspace.

## Run with Docker

```bash
docker compose up --build
# open http://localhost:3000 and sign up
```

## Run locally

```bash
cp .env.example .env            # point DATABASE_URL at a Postgres 14+
npm install
npx prisma migrate deploy
npm run db:seed                 # optional demo: demo@lookout.dev / lookout-demo-123
npm run dev                     # web on :3000
npm run worker                  # in a second terminal — polls feeds, sends alerts
```

## First 10 minutes

1. **Competitors** — add each with generous aliases (`uhc, unitedhealthcare, optum`). Aliases drive auto-attribution.
2. **Sources** — add RSS feeds. Fast start: one Google News RSS query per competitor, e.g. `https://news.google.com/rss/search?q="Acme Health"`, attached to that competitor, plus a couple of trade-press feeds left as "general market".
3. **Alerts** — one narrow instant rule (tier-1 competitors, importance ≥ 4) plus one weekly digest for leadership, both to Slack incoming webhooks.
4. **Settings → Invite links** — mint a link per role and drop it in your team channel.
5. Set `ANTHROPIC_API_KEY` for LLM classification; without it, keyword rules run.

## Competitor profiles & market data

Click any competitor to see its performance by segment, every individual and small-group product it sells, its rate filings (with SERFF numbers), and recent news. The **Market** page shows fully insured market share by state. Both come from public CMS files that import automatically a few minutes after deploy (status: Settings → Market data). See [ARCHITECTURE.md §2b](docs/ARCHITECTURE.md) for sources and limits.

## Scripts

`dev` · `build` · `start` · `worker` · `typecheck` · `test` · `smoke` · `market:import` · `mrf:reduce` · `db:migrate` · `db:deploy` · `db:seed` · `db:studio`

## Testing

- `npm test` — 41 unit tests, including market-data parsing and matching: classifier, attribution, dedupe, story clustering, alert rules, digest formatting, SSRF ranges, CSV escaping.
- `npm run smoke` — 35 end-to-end checks against a running web + worker + Postgres. It covers auth, validation, ingestion, clustering, alerts firing once per story, digests, tenant isolation, invites and CSV. Run the app and worker with `ALLOW_PRIVATE_URLS=true ALLOW_HTTP_WEBHOOKS=true`, then `SMOKE_HTTP_WEBHOOKS=true npm run smoke`.
- CI (`.github/workflows/ci.yml`) runs all of it on every push and PR against Postgres 16.

## Deploy

Same image, two services: `web` (`node server.js`) and `worker` (`npx tsx worker/index.ts`). Run `npx prisma migrate deploy` as a release step. Works on Railway, Render, Fly, ECS. Managed Postgres (Neon, RDS, Supabase) is fine; workers scale horizontally.
