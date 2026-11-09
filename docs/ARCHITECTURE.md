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

## 2b. Public market data

Competitor profiles and the Market page are built from two free CMS public use files, imported automatically by the worker and refreshed monthly:

| Dataset | What it gives | Granularity |
|---|---|---|
| **Unified Rate Review (URRT) PUF** | Every ACA individual & small-group rate filing: products, plans, metal, network type, on/off exchange, new/renewing/terminated, rate change, enrollment, PMPM, experience loss ratio, **SERFF tracking number** | Plan × filing, all 50 states + DC |
| **Medical Loss Ratio (MLR) PUF** | Premium, claims, covered lives, member months, broker commissions — fully insured comprehensive medical | Legal entity × state × segment (individual / small / large group) × year |

Design choices:
- **Not scraping SERFF Filing Access.** It's a session-based UI with terms we can't verify for automated use; the URRT PUF carries the same filings in structured form, with SERFF numbers linking back to the source.
- **Shared, not per-workspace.** Public data is stored once (`RateFiling`, `RatePlan`, `MarketFinancial`) and mapped to each workspace's competitors at query time via `Competitor.issuerPattern` — a regex over legal entity names (e.g. Point32Health = `harvard pilgrim|hphc|tufts (associated|insurance|health)`). Starter packs ship curated patterns; users can edit them on the profile page.
- **Imports run in a child process**, one dataset at a time, streaming the zip/CSV. Peak ~285 MB, isolated from the web server so a spike can't take the site down. A 0-row result is treated as a failure (CMS layout change) rather than silently empty data. Header case is normalized (CMS switched casing between years).
- **Known limits:** large-group products are not publicly filed (large group gets financials only); MLR covers fully insured business only — self-funded/ASO is invisible; data is as fresh as CMS publications (rate filings annually + quarterly small group; MLR annually, ~10 months after year end).

To add a new year: one line in `lib/marketdata/datasets.ts`.

### Large group (state sources)

| State | Source | What it adds | How it's loaded |
|---|---|---|---|
| MA | CHIA Enrollment Trends databook | Members by carrier × **fully/self-insured** × product × group size, quarterly | Automatic import (Excel) |
| ME | Bureau of Insurance financial results | Fully insured LG lives, premium, claims, **admin, underwriting gain** by carrier | Curated snapshot `data/state-large-group/me-boi.json` |
| RI | OHIC rate review | LG **requested vs approved** rates by carrier + trend/retention assumptions | Curated snapshot `ri-ohic.json` |
| NH | NHID cost drivers report | LG membership shares by carrier, fully & self-insured (2020–22) | Curated snapshot `nh-nhid.json` (estimates) |

PDF sources are snapshots, not scrapers: a regulator PDF layout changes every edition and a silent mis-parse is worse than a stale number. Every snapshot is guarded by tests (Maine rows must balance to the dollar and sum to published totals; RI weighted averages must reproduce the printed totals; NH shares must sum to 100%; every carrier must map to exactly one competitor). SERFF Filing Access isn't scraped (its network blocks automated clients and its terms aren't verifiable); profiles link to each state's SERFF search instead.

### Transparency in Coverage (machine-readable files)
`lib/marketdata/tic.ts`, dataset `tic`, monthly. Every insurer and TPA must publish a table of contents (TOC) listing each plan it insures or administers by EIN, plus in-network rate and allowed-amount files.
- **Automated:** Cigna (latest.json → zip of TOC JSONs, stream-parsed), UnitedHealthcare (blob listing; employer indexes name-matched to NE Form 5500 sponsors, then EIN-confirmed), Harvard Pilgrim (per-employer index links scraped from the plan list page), Mass General Brigham (single TOC; rate file sizes via HEAD).
- **Manual links:** BCBSMA, Aetna, Anthem, Tufts, Fallon, MaineCare/CHO, NHPRI, WellSense — JS portals, unreachable hosts, or multi-GB national indexes.
- Kept rows go to `PlanAdministration` (carrier × EIN × plan). Self-funded employers whose 5500 names no carrier get their administrator from here; regional carriers' plan lists become the large-group plan catalog on competitor profiles. Per-carrier run stats live in `MrfSource` and render at `/transparency`.
- Negotiated rates are measured, not ingested: national carriers publish ~100 TB/month. Regional rate files (MGB 18–78 MB each) are the feasible target for a rate benchmark.

### Negotiated rates (reducing TB-scale files)
`lib/marketdata/mrf/`, dataset `rates`, monthly. Rate files are a single JSON object of 2 GB–500 GB uncompressed; nothing about them fits in memory or in Postgres. The pipeline turns each file into a few thousand rows:
1. **Scan, don't parse** (`scan.ts`). A byte-level scanner tracks depth and string state, jumps over strings with `Buffer.indexOf`, and skips the `negotiated_rates` of every code outside the basket by bracket counting alone. Only small pieces are `JSON.parse`d: each `provider_references` element, each item header, and the rate elements of basket codes. ~300 MB/s vs ~35 MB/s for a general tokenizer; correctness is tested at every chunk boundary.
2. **Basket** (`codes.ts`). ~50 comparable services (CMS shoppable services, E&M, imaging, labs, MS-DRG and APR-DRG). Code types normalized (HCPCS→CPT, zero-padded DRGs, APR-DRG+severity suffix → base DRG).
3. **Never fan out** (`reduce.ts`). Prices accumulate per provider *group*; groups map to TINs through interned arrays. Output is (a) a network-wide distribution per code with each TIN counted once and (b) provider-level detail only for key providers: hospitals (inpatient DRG billers), the largest groups, and any TIN already tracked from another carrier. Dollar rate types only in comparisons; modifier and expired rates dropped.
4. **Sources** (`files.ts`). One import job per carrier (dataset `rates`, year = source #) so no job runs long: MGB (all networks), Harvard Pilgrim (every network referenced by its employer indexes), Tufts, Fallon, NHPRI, Community Health Options — each discovers its current files from the carrier's own index. Multi-part networks are merged exactly (`RateReducer` namespaces provider-group ids per part). Identical networks are fingerprinted and stored once; other networks of the same carrier are stored as deltas against its main network (changed prices + tombstones), rebuilt exactly by `effectiveRows()`. A source stops when the process passes `RATES_RSS_BUDGET_MB` (330), saves a cursor, and is marked `partial`; the scheduler resumes it immediately in a fresh process (native memory from Prisma/zlib only resets per process). APC-priced facility items map to every basket CPT in that APC (OPPS Addendum B).
   **Snapshots** (`data/rates/*.json.gz`, year 99, `npm run mrf:snapshot -- spec.json`): files a 512 MB server can't reduce (UHC/UMR, Cigna OAP/LocalPlus/PPO, Aetna) or whose index is browser-only (BCBSMA's table of contents; its signed links to BCBSMA HMO Blue and the New England Blues' BlueCard host files on bcbsma.mrf.bcbs.com work for any client). National files keep only tracked New England providers and no network distribution. Each snapshot carries a provenance note shown in the UI.
   Some hosts serve an incomplete TLS chain (DigiCert Global G2 TLS RSA SHA256 2020 CA1 missing); the intermediate ships in `data/certs/` and is trusted via `NODE_EXTRA_CA_CERTS` — verification stays on. Hosts that refuse automated clients (BCBSMA's own transparency site: 503; WellSense: Cloudflare challenge) are not worked around; the gap is disclosed. Zips are spooled to temp; gzip/JSON stream from the network. Peak ~300 MB with `MALLOC_ARENA_MAX=1` (native allocator fragmentation was the other ~100 MB).
5. **Comparisons** (`queries.ts`). Carrier price index = geometric mean of (carrier rate ÷ cross-carrier geometric mean) over every service × provider priced by 2+ carriers. Rendered on `/rates` and competitor profiles; CSV at `/api/v1/rates`.
6. **Provider identity**: names fall back to the IRS exempt-organization register (`data/irs/ne-health-orgs.json`); state = matched Medicare hospital's state → IRS register state → EIN prefix. Hospital TIN → CCN: reviewed map plus strict auto-matches (`scripts/match-hospitals.ts`: exact/containment name match, state must agree, unique best).
7. **% of Medicare** (`medicare.ts`, `data/medicare/`). `scripts/build-medicare-reference.ts` turns CMS's PFS RVU + GPCI files, OPPS Addendum B, CLFS and IPPS FY2027 (Table 5, Tables 1A–1E, Impact File) into a 40 KB reference. Professional → PFS in the provider's state (localities averaged); labs → CLFS; facility outpatient → OPPS APC × (0.6 × wage index + 0.4), office E&M → G0463; inpatient → hospital-specific IPPS (wage index, GAF, IME, DSH, UCP, VBP/readmission factors) via a reviewed TIN → CCN map (`hospital-tins.json`, test-guarded against EIN state prefixes); APR-DRGs compared to their MS-DRG family's average weight. Every null carries a reason.
8. **Data quality**: prices above 10× or below 0.2× the provider's Medicare rate are treated as outliers — bundled case rates filed under one code, or file errors (e.g. one hospital at ~$260K for every DRG): struck through in tables, excluded from the index and % of Medicare, listed by carrier. The carrier index is computed one service at a time and cached until rate data changes.
9. **Disclosure** (`rateGaps()`, `components/NotIncluded.tsx`). Discovery records every file it doesn't reduce and why; per-file stats count dropped prices; the Rates page and every other data page list what's left out.
National files (UHC/UMR, Cigna, Aetna: 10–100+ GB compressed) use the same code via `npm run mrf:reduce -- <url> out.csv` on a bigger machine.
10. **Refresh** (`scripts/refresh-snapshots.ts`, `npm run mrf:refresh`, run monthly as a scheduled task that commits the new snapshots). Cigna: `www.cigna.com/static/mrf/latest.json` → TOC zip → the Cigna Health & Life index → file by network slug. Aetna: HealthSparq `latest_metadata.json` → file by network code. UHC: blob listing → newest file with the same name. Blues: needs a browser-saved copy of BCBSMA's table of contents (`data/blue-toc.json`); otherwise kept and reported stale. Snapshots older than 45 days are flagged on the Rates page.

### Change detection (`lib/marketdata/events.ts`)

`MarketEvent` is global (public data), idempotent by `eventKey`, written after each import:
- **Accounts won/lost** — Form 5500 Schedule A health carriers for the same plan (EIN + plan number) in consecutive plan years, legal entities grouped by `canonicalCarrier()`. A change counts only if the carrier covers ≥50 people and ≥20% of participants (filters small add-on contracts); insured → self-funded is a loss for the insurer.
- **Rate filings** — New England URRT filings: enrollment-weighted average rate change of renewing plans; ±8% or more is "major".
- **Negotiated-rate changes** — `RateHistory` keeps each carrier × provider × service median per month (13 months, written when the carrier index is recomputed). ≥5% and ≥$5 month over month → one event per carrier × provider. Network add/drop only when a carrier's coverage is otherwise stable (>80% of last month's providers present), so a failed file doesn't read as a mass termination.
- **Fan-out** — the hourly `sync_market_events` job (and one after every import) turns events whose carrier matches a competitor's issuer pattern into Signals (`PRICING`/`NETWORK`/`OTHER`), deduped by the signal key; events older than 45 days are added silently (no alerts) so new competitors get history without an alert storm.

### Networks (`lib/marketdata/networks.ts`)

CMS Hospital General Information (via `scripts/build-hospital-directory.ts`) gives 213 New England hospitals with ZIP-centroid coordinates (`data/networks/hospitals.json`). A carrier "has" a hospital when its latest `RateHistory` contains institutional prices at one of the hospital's TINs (inpatient DRG → in network; facility CPT only → outpatient only). Breadth = share of the state's matched acute, critical-access and children's hospitals. Hospitals with no TIN match are "unknown", never "out". The map is server-rendered SVG (us-atlas + d3-geo), no client JS.

### Ops

- **SSO** (`lib/sso.ts`, `/api/v1/auth/sso/{start,callback}`): OIDC authorization code + PKCE, state/nonce in a 10-minute httpOnly cookie scoped to the SSO path, ID token verified against the issuer's JWKS (issuer, audience, expiry, nonce, `email_verified`), email-domain allow-list. Unknown users are provisioned into `OIDC_WORKSPACE_ID` with `OIDC_DEFAULT_ROLE` (OWNER is downgraded to ADMIN) and an unusable random password.
- **Backups**: Render Postgres point-in-time recovery + on-demand exports; `GET /api/v1/admin/export` (OWNER) for a workspace-level JSON.
- **Hosting**: `render.yaml` runs web + worker on one Standard instance (1 CPU, 2 GB) with `RATES_RSS_BUDGET_MB=1200`; the importers still fit Starter (512 MB) at the default budget.

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
│   ├── marketdata/    (datasets.ts, import.ts streaming CMS importer, run.ts child-process runner, queries.ts profiles + market share)
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
| GET | `/competitors/:id/profile?state=` | viewer | performance by segment/year, products & plans, rate filings (SERFF #), matched legal entities |
| GET | `/market?state&segment&year` | viewer | fully insured market share by competitor + ACA rate actions |
| GET/POST | `/market-data` | viewer / admin | import status; POST re-imports everything |
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
| Enterprise sales | first security questionnaire | SAML via an OIDC bridge (OIDC SSO is built in), audit log table, per-workspace API keys, SCIM |

## 8. Security notes

bcrypt(12) passwords · sha256-hashed session tokens · httpOnly/SameSite=Lax/Secure cookies · zod on every input · per-workspace scoping on every query · role checks in one wrapper · HTTPS-only webhooks · rate-limited auth · security headers (X-Frame-Options, nosniff, referrer policy). SSRF guard on feeds and webhooks (every redirect hop) · hashed, revocable, expiring invite tokens · CSV formula-injection protection. Known gaps: rate limiter is per-instance (move to Redis with >1 web replica); DNS rebinding between check and connect (close with an egress proxy). `ALLOW_PRIVATE_URLS` and `ALLOW_HTTP_WEBHOOKS` exist for dev/CI only and must never be set in production.
