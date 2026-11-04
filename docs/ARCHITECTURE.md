# Lookout — Architecture

Competitive-intelligence signal tracker. Pulls competitor news from feeds, attributes and classifies each item, dedupes it, puts it in a shared triage feed, and pushes the important ones to Slack.

## 1. Product scope (MVP)

| In | Out (deliberately, for now) |
|---|---|
| Multi-tenant workspaces, roles (owner/admin/analyst/viewer), invite links, workspace switcher | SSO/SAML, SCIM |
| Competitors with aliases + tiers | Competitor profiles / battlecards |
| RSS/Atom sources, scheduled + on-demand polling | Web-page diffing, SEC/EDGAR, regulator filings parsers |
| Manual signal logging (field intel) | Browser extension / email-in |
| Auto attribution, rule classifier, optional LLM classifier | Embedding-based clustering |
| Story clustering: one feed row per event, "+N outlets" | Cross-competitor stories (e.g. a merger of two tracked rivals) |
| Triage: status, importance, type, tags, comments; CSV export | Native PPT/Docs export |
| Alert rules → Slack-compatible webhooks (instant or weekly digest), retried | Email delivery, per-user notification prefs |

The deliberate bet: **the triage loop is the product**, not the scraping. Ingestion is commodity; a team actually reviewing, escalating and discussing signals is what makes CI land with leadership. So the MVP spends its complexity on the feed, triage and alerts and keeps ingestion simple and swappable.

## 2. System architecture

```
                ┌───────────────────────── Browser ─────────────────────────┐
                │  Server-rendered pages (RSC)  +  small client islands      │
                └───────────────┬───────────────────────────┬───────────────┘
                                │ HTML (RSC)                │ JSON  /api/v1/*
                ┌───────────────▼───────────────────────────▼───────────────┐
                │                   Next.js web (stateless)                   │
                │  middleware (cookie gate) → route() wrapper: auth, RBAC,    │
                │  zod validation, error envelope → lib/* domain services     │
                └───────────────┬───────────────────────────┬───────────────┘
                                │ Prisma                    │ enqueue jobs
                ┌───────────────▼───────────────────────────▼───────────────┐
                │                         PostgreSQL                          │
                │   tenants · domain tables · Job queue (SKIP LOCKED)         │
                └───────────────▲───────────────────────────▲───────────────┘
                                │ claim / complete           │
                ┌───────────────┴───────────────────────────┴───────────────┐
                │                    Worker (N replicas)                      │
                │  scheduler tick → poll_source jobs → ingestSignal()         │
                │  deliver_alert jobs → Slack/Teams/any HTTPS webhook          │
                └──────────┬──────────────────────────────┬──────────────────┘
                           │ RSS/Atom                      │ optional
                      external feeds                Anthropic API (classifier)
```

**Two process types, one codebase, one image.** `web` serves pages + API and never does slow I/O inline. `worker` does everything that touches the outside world (feeds, webhooks, LLM). Both are stateless; Postgres is the only stateful component.

### Key design decisions

1. **Postgres as the queue.** `Job` table + `FOR UPDATE SKIP LOCKED` gives at-least-once delivery, retries with exponential backoff (30s → 2m → 8m → 32m → FAILED), stale-job reaping, and safe horizontal scaling of workers — with zero extra infrastructure. The job contract (`kind` + JSON `payload`) is queue-agnostic, so moving to SQS/BullMQ later is a change in `lib/jobs.ts` only.
2. **One write path for signals.** `ingestSignal()` is used by both manual entry and ingestion: dedupe → attribute → classify → insert (`ON CONFLICT DO NOTHING`) → tag → evaluate alerts. Concurrency-safe by construction; tested with two simultaneous polls of the same feed (one insert, one alert).
3. **Dedupe on normalized URL** (tracking params, `www`, fragments, trailing slash stripped), falling back to normalized title; key is `sha256(workspaceId|basis)`, unique per workspace.
4. **Classifier is two-tier.** Deterministic regex rules (free, testable, always on) + optional LLM pass when `ANTHROPIC_API_KEY` is set. The LLM has a 15s timeout and any failure falls back silently to rules — ingestion never blocks on it.
5. **Tenant isolation at the query layer.** Every handler resolves the session's `workspaceId` and every lookup filters on it; a foreign id returns 404, not 403 (no existence leak). Verified in testing.
6. **DB-backed sessions**, not JWTs: httpOnly cookie holds a random token, DB stores only its sha256. Revocation = delete the row. Removing a membership instantly locks the user out.
7. **Story clustering, precision over recall.** Feed items are compared with the last 72h of same-competitor signals using light-stemmed title-token Jaccard (≥0.5, ≥3 shared tokens) plus a numbers-must-agree rule (Q2 ≠ Q3, 9.8% ≠ 6.1%). A match points `duplicateOfId` at the story lead. The feed shows leads only; instant alerts fire on leads only, so five outlets covering one merger produce one alert. Manual entries are never clustered. A wrong merge can be undone with "split out" on the signal page.
8. **Weekly digests reuse the queue.** A digest rule is claimed by the scheduler when ≥7 days have passed since it last fired. Claim and stamp happen in one statement, so replicas can't double-send. The first run fires immediately and covers the last 7 days, which doubles as a confirmation that the webhook works.
9. **Outbound URLs are untrusted.** Feed and webhook URLs are user-supplied and fetched from inside your network. Every hop (redirects included) is DNS-resolved and rejected if it lands on private, loopback, link-local or metadata ranges; bodies are capped at 5 MB; webhooks never follow redirects. URLs are checked at creation (422) and again at fetch time.
10. **UTC everywhere.** Raw SQL uses `now() AT TIME ZONE 'UTC'` because Prisma stores naive UTC timestamps; plain `now()` on a non-UTC Postgres would schedule jobs hours late. (Found and fixed during build.)

## 3. File structure

```
lookout/
├── app/
│   ├── (auth)/login, signup/        # public pages
│   ├── (app)/                       # authed shell (layout checks session)
│   │   ├── feed/                    # signal feed: stats, filters, triage
│   │   ├── signals/[id]/            # detail: triage panel + discussion
│   │   ├── competitors/  sources/  alerts/  settings/
│   │   └── layout.tsx
│   ├── api/v1/                      # REST API (see §5)
│   ├── join/[token]/                # invite landing: sign up or accept
│   ├── layout.tsx  globals.css  page.tsx
├── components/                      # UI: Nav, forms, QuickTriage, SignalEditor, ui primitives
├── lib/
│   ├── db.ts          auth.ts       api.ts (route wrapper, errors)
│   ├── validators.ts  (zod — single source of input truth)
│   ├── signals.ts     (ingestSignal: the write path)
│   ├── classify.ts    match.ts (attribution, URL normalize, dedupe key)
│   ├── cluster.ts     (story clustering)
│   ├── net.ts         (SSRF guard, safeFetch)   csv.ts   invites.ts
│   ├── ingest.ts      (RSS polling, due-source claiming)
│   ├── alerts.ts      (rule matching, instant delivery, weekly digest)
│   ├── jobs.ts        (Postgres queue)
│   ├── queries.ts     (feed + stats; shared by API and pages)
│   ├── rate-limit.ts  client.ts
├── worker/index.ts                  # scheduler + job runner
├── prisma/schema.prisma  migrations/  seed.ts
├── tests/core.test.ts               # classifier, matcher, dedupe, clustering, alert rules, digest, SSRF, CSV
├── scripts/smoke.ts                 # 35-check end-to-end test against a running stack
├── .github/workflows/ci.yml         # typecheck, unit tests, build, migrate, e2e smoke on Postgres 16
├── middleware.ts  Dockerfile  docker-compose.yml  .env.example
```

## 4. Database schema

| Table | Purpose | Notable constraints / indexes |
|---|---|---|
| `User` | identity | `email` unique |
| `Workspace` | tenant | `slug` unique |
| `Membership` | user↔workspace + `Role` | unique (user, workspace) |
| `Session` | login sessions | `tokenHash` unique; stores active workspace |
| `Competitor` | tracked companies, `aliases[]`, `tier` 1–3 | unique (workspace, name) |
| `Source` | RSS feed (or MANUAL); optional competitor; `pollMinutes`, `lastError` | index (enabled, lastPolledAt) for scheduler |
| `Signal` | the core record: type, importance 1–5, status, dedupeKey, `duplicateOfId` (story lead) | unique (workspace, dedupeKey); 4 composite feed indexes, all `createdAt DESC`; index on duplicateOfId |
| `Tag` / `SignalTag` | free tagging | unique (workspace, name) |
| `Comment` | discussion on a signal | index (signal, createdAt) |
| `AlertRule` | AND of competitors[], types[], keywords[], minImportance → webhookUrl; `mode` INSTANT or DIGEST_WEEKLY | index (workspace, enabled); (mode, enabled, lastFiredAt) |
| `Invite` | hashed join token, role, uses/maxUses, expiry, revokedAt | `tokenHash` unique |
| `Job` | queue | index (status, runAt) |

Enums: `Role`, `SourceKind`, `AlertMode`, `SignalType` (PRICING, PRODUCT, NETWORK, REGULATORY, LEADERSHIP, M_AND_A, PARTNERSHIP, FINANCIAL, OTHER), `SignalStatus` (NEW, REVIEWED, ESCALATED, ARCHIVED), `JobStatus`. Full DDL: `prisma/migrations/*/migration.sql`.

## 5. API (`/api/v1`)

Envelope: success `{ data }`, failure `{ error: { message, details? } }`. Codes: 401 unauthenticated, 403 role, 404 not found / other tenant, 409 duplicate, 422 validation, 429 rate-limited.

| Method | Path | Min role | Notes |
|---|---|---|---|
| POST | `/auth/signup` | — | creates user + workspace (OWNER), or joins via `inviteToken`; rate-limited |
| POST | `/auth/login` · `/auth/logout` | — | rate-limited, no account enumeration |
| GET | `/auth/me` | viewer | |
| POST | `/auth/switch` | viewer | switch active workspace (must be a member) |
| GET | `/signals` | viewer | `q, status, type, competitorId, minImportance, tag, cursor, limit` → `{ items, nextCursor }` |
| POST | `/signals` | analyst | manual entry; type/importance optional (classifier fills) |
| GET | `/signals/export` | viewer | CSV of the current filters, up to 5,000 rows, formula-injection safe |
| GET/PATCH/DELETE | `/signals/:id` | viewer / analyst / admin | GET includes story coverage; PATCH = triage, tag replace, `duplicateOfId: null` to split out |
| GET/POST | `/signals/:id/comments` | viewer / analyst | |
| GET/POST | `/competitors` | viewer / analyst | |
| GET/PATCH/DELETE | `/competitors/:id` | viewer / analyst / admin | |
| GET/POST | `/sources` | viewer / analyst | |
| PATCH/DELETE | `/sources/:id` | analyst / admin | |
| POST | `/sources/:id/poll` | analyst | queues immediate poll |
| GET/POST | `/alerts` | viewer / admin | `mode`: INSTANT \| DIGEST_WEEKLY; webhook must be HTTPS and public |
| PATCH/DELETE | `/alerts/:id` | admin | |
| GET | `/stats` | viewer | untriaged, escalated, 7-day volume, by type, top competitors, failing sources |
| GET/POST | `/members` | viewer / admin | add existing user by email |
| GET/POST | `/invites` | admin | POST returns the join URL once |
| DELETE | `/invites/:id` | admin | revoke |
| POST | `/invites/accept` | signed in | join + switch into the workspace; 410 if expired/revoked/used up |
| GET | `/health` | — | DB ping, for load balancer |

## 6. UI architecture

- **Server Components by default.** Pages query Postgres directly through the same `lib/queries.ts` the API uses, so there's no client-side data layer to keep in sync and first paint is complete.
- **Client islands only where interaction happens:** `QuickTriage`, `SignalEditor`, `CommentForm`, `NewSignalForm`, `forms.tsx`, `ActionButton`, `Nav`. Each mutates via `/api/v1` and calls `router.refresh()` — the server re-renders and is the single source of truth.
- **Filters live in the URL** (plain GET form), so every filtered view is shareable and back-button safe. Cursor pagination via `?cursor=`.
- **Design:** dense newsroom feed — status dot, type badge, 5-tick importance meter, competitor, source, age. One accent color (amber) reserved for "needs attention". Works at phone width.

## 7. Scaling path

| Pressure | Signal it's time | Move |
|---|---|---|
| Feed search slow | > ~1M signals/workspace | `tsvector` generated column + GIN index; swap ILIKE in `queries.ts` |
| Queue contention | > ~50 jobs/sec | `lib/jobs.ts` → SQS or BullMQ/Redis; job contract unchanged |
| Web replicas > 1 | now, in prod | move `rate-limit.ts` to Redis |
| Clustering misses paraphrased headlines | analysts keep hitting "split"/seeing dupes | embeddings (pgvector) for the candidate match; `findLead()` interface unchanged |
| Big tenants | any single workspace dominates | Postgres RLS on `workspaceId` as defense-in-depth; then partition `Signal` by workspace hash |
| Enterprise sales | first security questionnaire | SSO (WorkOS/Auth.js), audit log table, per-workspace API keys |

## 8. Security notes

bcrypt(12) passwords · sha256-hashed session tokens · httpOnly/SameSite=Lax/Secure cookies · zod on every input · per-workspace scoping on every query · role checks in one wrapper · HTTPS-only webhooks · rate-limited auth · security headers (X-Frame-Options, nosniff, referrer policy). SSRF guard on feeds and webhooks (every redirect hop) · hashed, revocable, expiring invite tokens · CSV formula-injection protection. Known gaps: rate limiter is per-instance (move to Redis with >1 web replica); DNS rebinding between check and connect (close with an egress proxy). `ALLOW_PRIVATE_URLS` and `ALLOW_HTTP_WEBHOOKS` exist for dev/CI only and must never be set in production.
