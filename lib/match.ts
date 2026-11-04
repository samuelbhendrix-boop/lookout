import { createHash } from "node:crypto";

type CompetitorLite = { id: string; name: string; aliases: string[] };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Attributes an item to a competitor by whole-word match on name or aliases.
 * Returns the competitor with the most hits (ties → first), or null.
 */
export function matchCompetitor(text: string, competitors: CompetitorLite[]): string | null {
  let best: { id: string; hits: number } | null = null;
  for (const c of competitors) {
    const terms = [c.name, ...c.aliases].filter(Boolean);
    let hits = 0;
    for (const t of terms) {
      const re = new RegExp(`\\b${escape(t)}\\b`, "gi");
      hits += text.match(re)?.length ?? 0;
    }
    if (hits > 0 && (!best || hits > best.hits)) best = { id: c.id, hits };
  }
  return best?.id ?? null;
}

/** Strips tracking params and fragments so the same article from two feeds dedupes. */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    for (const p of [...u.searchParams.keys()])
      if (/^(utm_|fbclid|gclid|mc_|ref$|source$)/i.test(p)) u.searchParams.delete(p);
    u.hostname = u.hostname.replace(/^www\./, "");
    return u.toString().replace(/\/$/, "");
  } catch {
    return raw.trim();
  }
}

export function dedupeKey(workspaceId: string, url: string | undefined | null, title: string): string {
  const basis = url ? normalizeUrl(url) : title.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(`${workspaceId}|${basis}`).digest("hex");
}
