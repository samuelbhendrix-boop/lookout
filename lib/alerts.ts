import type { AlertRule, Signal } from "@prisma/client";
import { db } from "./db";
import { enqueue } from "./jobs";
import { safeFetch } from "./net";

/** Pure predicate — unit tested. All configured conditions must match (AND); empty lists = any. */
export function ruleMatches(rule: Pick<AlertRule, "competitorIds" | "types" | "keywords" | "minImportance">, s: Pick<Signal, "competitorId" | "type" | "importance" | "title" | "summary">) {
  if (s.importance < rule.minImportance) return false;
  if (rule.competitorIds.length && (!s.competitorId || !rule.competitorIds.includes(s.competitorId))) return false;
  if (rule.types.length && !rule.types.includes(s.type)) return false;
  if (rule.keywords.length) {
    const text = `${s.title} ${s.summary ?? ""}`.toLowerCase();
    if (!rule.keywords.some((k) => text.includes(k))) return false;
  }
  return true;
}

const typeLabel = (t: Signal["type"]) => (t === "M_AND_A" ? "M&A" : t.toLowerCase());
const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

/** Slack-compatible incoming-webhook POST; also works for Teams workflows and generic receivers. */
async function postWebhook(url: string, body: unknown) {
  const res = await safeFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  }, 0); // webhooks never follow redirects
  if (!res.ok) throw new Error(`Webhook ${res.status}: ${res.text.slice(0, 200)}`);
}

/** Instant rules: enqueue one delivery per matching rule. Digest rules pick signals up on their schedule. */
export async function evaluateAlerts(signal: Signal) {
  const rules = await db.alertRule.findMany({
    where: { workspaceId: signal.workspaceId, enabled: true, mode: "INSTANT" },
  });
  for (const rule of rules) {
    if (ruleMatches(rule, signal))
      await enqueue(signal.workspaceId, "deliver_alert", { ruleId: rule.id, signalId: signal.id });
  }
}

export async function deliverAlert(ruleId: string, signalId: string) {
  const [rule, signal] = await Promise.all([
    db.alertRule.findUnique({ where: { id: ruleId } }),
    db.signal.findUnique({ where: { id: signalId }, include: { competitor: true } }),
  ]);
  if (!rule || !signal || !rule.enabled) return; // deleted/disabled since enqueue — drop silently

  const who = signal.competitor ? `*${signal.competitor.name}* · ` : "";
  const text =
    `🔔 ${rule.name}\n${who}${typeLabel(signal.type)} · importance ${signal.importance}/5\n` +
    `<${appUrl()}/signals/${signal.id}|${signal.title}>` +
    (signal.url ? `\nSource: ${signal.url}` : "");
  await postWebhook(rule.webhookUrl, {
    text,
    signal: { id: signal.id, title: signal.title, type: signal.type, importance: signal.importance, url: signal.url },
  });
  await db.alertRule.update({ where: { id: rule.id }, data: { lastFiredAt: new Date() } });
}

// ─── Weekly digest ───────────────────────────────────────────────────

/**
 * Claims digest rules that are due (never fired, or fired ≥7 days ago) and stamps them in the
 * same statement so concurrent schedulers can't double-send. Returns the window start for each.
 */
export async function claimDueDigests() {
  return db.$queryRaw<Array<{ id: string; workspaceId: string; prev: Date | null }>>`
    WITH due AS (
      SELECT id, "lastFiredAt" AS prev FROM "AlertRule"
      WHERE enabled AND mode = 'DIGEST_WEEKLY'
        AND ("lastFiredAt" IS NULL OR "lastFiredAt" <= (now() AT TIME ZONE 'UTC') - interval '7 days')
      FOR UPDATE SKIP LOCKED
      LIMIT 50
    )
    UPDATE "AlertRule" a SET "lastFiredAt" = (now() AT TIME ZONE 'UTC')
    FROM due WHERE a.id = due.id
    RETURNING a.id, a."workspaceId", due.prev`;
}

/** Builds the digest text — pure, unit tested. Top items by importance, grouped by competitor. */
export function formatDigest(
  ruleName: string,
  items: Array<{ id: string; title: string; type: Signal["type"]; importance: number; competitor: string | null; coverage: number }>,
  base = appUrl(),
) {
  if (!items.length) return `🗞️ ${ruleName} — weekly digest\nQuiet week: no matching signals.`;
  const groups = new Map<string, typeof items>();
  for (const it of items) {
    const k = it.competitor ?? "Market";
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  const lines = [`🗞️ ${ruleName} — weekly digest (${items.length} ${items.length === 1 ? "signal" : "signals"})`];
  for (const [who, list] of groups) {
    lines.push("", `*${who}*`);
    for (const s of list)
      lines.push(`• [${s.importance}] ${typeLabel(s.type)} — <${base}/signals/${s.id}|${s.title}>${s.coverage ? ` (+${s.coverage} outlets)` : ""}`);
  }
  return lines.join("\n");
}

export async function sendDigest(ruleId: string, sinceIso: string) {
  const rule = await db.alertRule.findUnique({ where: { id: ruleId } });
  if (!rule || !rule.enabled) return;
  const since = new Date(sinceIso);
  const signals = await db.signal.findMany({
    where: {
      workspaceId: rule.workspaceId,
      duplicateOfId: null,
      status: { not: "ARCHIVED" },
      createdAt: { gte: since },
      importance: { gte: rule.minImportance },
      competitorId: rule.competitorIds.length ? { in: rule.competitorIds } : undefined,
      type: rule.types.length ? { in: rule.types } : undefined,
    },
    orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: { competitor: { select: { name: true } }, _count: { select: { coverage: true } } },
  });
  const matched = signals.filter((s) => ruleMatches(rule, s)).slice(0, 15); // keywords filtered in JS
  const text = formatDigest(
    rule.name,
    matched.map((s) => ({ id: s.id, title: s.title, type: s.type, importance: s.importance, competitor: s.competitor?.name ?? null, coverage: s._count.coverage })),
  );
  await postWebhook(rule.webhookUrl, { text, digest: { ruleId: rule.id, since: since.toISOString(), count: matched.length } });
}
