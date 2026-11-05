/**
 * End-to-end smoke test against a running stack (web + worker + Postgres).
 *
 *   BASE_URL=http://localhost:3000 npx tsx scripts/smoke.ts
 *
 * Starts its own fake RSS feed and webhook receiver on localhost, so the app and worker must run
 * with ALLOW_PRIVATE_URLS=true. Creates throwaway users/workspaces with random emails; safe to
 * rerun. Exits non-zero on the first failed check.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const run = Math.random().toString(36).slice(2, 8);
let passed = 0;

function check(cond: unknown, label: string): asserts cond {
  if (!cond) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`✓ ${label}`);
}

class Client {
  cookie = "";
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(`${BASE}/api/v1${path}`, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* csv */ }
    return { status: res.status, data: json?.data, error: json?.error, text };
  }
}

// ── Fake outside world ─────────────────────────────────────────────
const hooks: any[] = [];
let feedItems: Array<{ title: string; link: string; description?: string }> = [];
const rss = () =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>Smoke wire</title>${feedItems
    .map((i: any) => `<item><title>${i.title}</title><link>${i.link}</link><description>${i.description ?? ""}</description>${i.pubDate ? `<pubDate>${i.pubDate}</pubDate>` : ""}</item>`)
    .join("")}</channel></rss>`;

const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/feed")) {
    res.setHeader("content-type", "application/rss+xml");
    return res.end(rss());
  }
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    try { hooks.push(JSON.parse(b)); } catch { hooks.push(b); }
    res.end("ok");
  });
});

async function waitFor<T>(fn: () => Promise<T | undefined | false>, label: string, ms = 45_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 1000));
  }
  check(false, `${label} (timed out — is the worker running with ALLOW_PRIVATE_URLS=true?)`);
  throw new Error("unreachable");
}

async function main() {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const local = `http://127.0.0.1:${port}`;

  const a = new Client(), b = new Client(), c = new Client();

  // ── Auth & validation
  check((await a.req("GET", "/signals")).status === 401, "unauthenticated API → 401");
  check((await a.req("POST", "/auth/signup", { email: "nope", password: "x" })).status === 422, "invalid signup → 422");
  const pw = "smoke-test-password";
  check((await a.req("POST", "/auth/signup", { email: `a-${run}@smoke.test`, password: pw, workspaceName: `Smoke A ${run}` })).status === 201, "signup A");
  check((await b.req("POST", "/auth/signup", { email: `b-${run}@smoke.test`, password: pw, workspaceName: `Smoke B ${run}` })).status === 201, "signup B");
  check((await new Client().req("POST", "/auth/login", { email: `a-${run}@smoke.test`, password: "wrong-password" })).status === 401, "wrong password → 401");

  // ── Setup
  const harbor = await a.req("POST", "/competitors", { name: "Harbor Mutual", aliases: ["harbor"], tier: 1 });
  check(harbor.status === 200 && harbor.data.id, "create competitor");
  check((await a.req("POST", "/competitors", { name: "Harbor Mutual" })).status === 409, "duplicate competitor → 409");

  // Production rejects non-HTTPS webhooks. The app only accepts http:// when ALLOW_HTTP_WEBHOOKS=true (dev/CI).
  const allowHttp = process.env.SMOKE_HTTP_WEBHOOKS === "true";

  // ── Ingestion, attribution, classification, clustering
  feedItems = [
    { title: "Harbor Mutual announces merger with Bayline Health", link: "https://news.example/harbor-bayline?utm_source=rss", description: "A $3 billion deal." },
    { title: "Weather delays regional conference", link: "https://news.example/weather" },
  ];
  const src = await a.req("POST", "/sources", { name: "Smoke wire", url: `${local}/feed`, pollMinutes: 15 });
  check(src.status === 200, "create RSS source");

  if (allowHttp) {
    const r1 = await a.req("POST", "/alerts", { name: "Tier-1 M&A", mode: "INSTANT", types: ["M_AND_A"], competitorIds: [harbor.data.id], minImportance: 3, webhookUrl: `${local}/hook-instant` });
    check(r1.status === 200, "create instant rule");
  }

  check((await a.req("POST", `/sources/${src.data.id}/poll`)).status === 200, "queue poll");
  const first = await waitFor(async () => {
    const r = await a.req("GET", "/signals?limit=50");
    return r.data?.items?.some((s: any) => s.title.includes("Bayline")) && r.data.items;
  }, "worker ingested feed");
  const merger = first.find((s: any) => s.title.includes("Bayline"));
  check(merger?.competitor?.id === harbor.data.id, "auto-attributed to competitor via alias");
  check(merger?.type === "M_AND_A" && merger.importance >= 4, "classified as high-importance M&A");

  feedItems.push({ title: "Harbor Mutual names new CFO in 2019 shakeup", link: "https://old.example/harbor-cfo", pubDate: "Mon, 04 Mar 2019 12:00:00 GMT" } as any);
  feedItems.push({ title: "Harbor Mutual, Bayline Health to merge in $3B deal", link: "https://other.example/harbor-bayline-merge" });
  feedItems.push({ title: "Harbor Mutual announces merger with Bayline Health", link: "https://www.news.example/harbor-bayline" }); // same URL, normalized
  await a.req("POST", `/sources/${src.data.id}/poll`);
  await waitFor(async () => {
    const r = await a.req("GET", `/signals/${merger.id}`);
    return r.data?.coverage?.length === 1 || undefined;
  }, "second outlet clustered under the story lead");
  const feed = (await a.req("GET", "/signals?limit=50")).data.items;
  check(feed.filter((s: any) => s.title.includes("Bayline")).length === 1, "feed shows one row per story");
  const all = (await a.req("GET", "/signals?q=CFO&limit=50")).data.items;
  check(all.length === 0, "7-year-old article never ingested");
  check(feed.length === 1, "tracking-param URL variant deduped; off-topic market item kept out of the feed");
  const archived = (await a.req("GET", "/signals?status=ARCHIVED&limit=50")).data.items;
  check(archived.some((s: any) => s.title.startsWith("Weather") && s.tags.some((t: any) => t.tag.name === "auto-filtered")), "off-topic item archived and tagged auto-filtered (not lost)");

  // ── Manual entry, dedupe, triage, comments
  const manual = await a.req("POST", "/signals", { title: "Broker: Harbor discounting 3% on 50-99 groups", tags: ["Broker"] });
  check(manual.status === 201 && manual.data.type === "PRICING", "manual signal classified as pricing");
  check((await a.req("POST", "/signals", { title: "broker:  harbor discounting 3% on 50-99 groups" })).status === 409, "manual duplicate → 409");
  check((await a.req("PATCH", `/signals/${merger.id}`, { status: "ESCALATED", tags: ["board"] })).status === 200, "triage update");
  check((await a.req("POST", `/signals/${merger.id}/comments`, { body: "Bayline gives them the north shore." })).status === 201, "comment");
  check((await a.req("GET", "/signals?tag=board")).data.items.length === 1, "tag filter");

  // ── Tenant isolation
  check((await b.req("GET", `/signals/${merger.id}`)).status === 404, "other tenant cannot read signal");
  check((await b.req("PATCH", `/signals/${merger.id}`, { status: "ARCHIVED" })).status === 404, "other tenant cannot modify signal");
  check((await b.req("GET", "/signals")).data.items.length === 0, "other tenant feed is empty");

  // ── CSV export
  const csv = await a.req("GET", "/signals/export");
  check(csv.status === 200 && csv.text.startsWith("date,competitor,type"), "CSV export");
  check(csv.text.includes("Bayline") && !csv.text.includes("Weather delays"), "CSV mirrors the feed (archived excluded)");

  // ── Invites
  const inv = await a.req("POST", "/invites", { role: "VIEWER", days: 1 });
  check(inv.status === 201 && inv.data.url.includes("/join/"), "create invite link");
  const token = inv.data.url.split("/join/")[1];
  check((await c.req("POST", "/auth/signup", { email: `c-${run}@smoke.test`, password: pw, inviteToken: token })).status === 201, "signup via invite");
  const me = await c.req("GET", "/auth/me");
  check(me.data.workspaceName === `Smoke A ${run}` && me.data.role === "VIEWER", "invitee lands in workspace with invite role");
  check((await c.req("POST", "/competitors", { name: "Nope" })).status === 403, "viewer cannot write");
  check((await b.req("POST", "/invites/accept", { token })).status === 200, "existing user accepts invite");
  check((await b.req("GET", "/auth/me")).data.workspaceName === `Smoke A ${run}`, "accepting switches workspace");
  const bWs = (await b.req("POST", "/auth/switch", { workspaceId: "c" + "x".repeat(24) })).status;
  check(bWs === 404, "cannot switch into a workspace you're not in");
  await a.req("DELETE", `/invites/${inv.data.id}`);
  check((await new Client().req("POST", "/auth/signup", { email: `d-${run}@smoke.test`, password: pw, inviteToken: token })).status === 410, "revoked invite → 410");

  // ── Alerts (needs SMOKE_HTTP_WEBHOOKS=true + ALLOW_HTTP_WEBHOOKS=true on the app)
  if (allowHttp) {
    // Created now so its first run (which fires immediately, covering the past 7 days) sees the data above.
    const r2 = await a.req("POST", "/alerts", { name: "Weekly", mode: "DIGEST_WEEKLY", minImportance: 1, webhookUrl: `${local}/hook-digest` });
    check(r2.status === 200, "create digest rule");
    await waitFor(async () => hooks.some((h) => h.digest) || undefined, "weekly digest delivered");
    const instantHits = hooks.filter((h) => h.signal?.type === "M_AND_A");
    check(instantHits.length === 1, "instant alert fired exactly once per story (not per outlet)");
    check(hooks.find((h) => h.digest)?.text?.includes("Harbor Mutual"), "digest groups by competitor");
  } else {
    console.log("· skipped webhook delivery checks (set SMOKE_HTTP_WEBHOOKS=true and ALLOW_HTTP_WEBHOOKS=true)");
  }

  console.log(`\n${passed} checks passed`);
  server.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
