/**
 * Story clustering — groups the same event reported by several outlets.
 *
 * Deliberately lexical (no embeddings): titles from different outlets about one event share
 * most of their content words. Precision beats recall here — a wrongly merged signal is hidden
 * from the feed, which is worse than a duplicate showing up twice — so the rules are strict:
 *   - same competitor (or both unattributed), within a 72h window
 *   - Jaccard on light-stemmed content tokens ≥ 0.5, at least 3 shared tokens
 *   - numbers must agree: "Q2 earnings" never merges with "Q3 earnings"
 * At scale, swap the candidate scan for pg_trgm or a vector index; the interface stays.
 */

const STOP = new Set(
  "a an the and or of to in on for with by at from as is are was were be been its it this that new says said after over into amid about up out than more will would could plans plan announces announced report reports".split(" "),
);

/** Very light stemmer — enough to align merger/merge/merged, launches/launch, plans/plan. */
function stem(w: string) {
  return w.replace(/(ings?|ers?|ed|es|s)$/, "") || w;
}

export function titleTokens(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9$%.]+/)
    .map((w) => w.replace(/^[.]+|[.]+$/g, ""))
    .filter((w) => w.length > 1 && !STOP.has(w));
  // Numbers keep only their digits so "$3", "3b" and "3bn" agree; "q3" stays distinct from "3".
  return new Set(words.map((w) => (/^q[1-4]$/.test(w) ? w : /\d/.test(w) ? w.match(/\d+(\.\d+)?/)![0] : stem(w))));
}

const numeric = (s: Set<string>) => new Set([...s].filter((t) => /\d/.test(t)));

export function isSameStory(a: Set<string>, b: Set<string>): boolean {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  const union = a.size + b.size - shared;
  if (shared < 3 || union === 0 || shared / union < 0.5) return false;
  const na = numeric(a);
  const nb = numeric(b);
  if (na.size && nb.size && ![...na].some((n) => nb.has(n))) return false;
  return true;
}

export type ClusterCandidate = { id: string; title: string; duplicateOfId: string | null; competitorId: string | null };

/** Returns the lead signal id this title belongs under, or null if it starts a new story. */
export function findLead(title: string, competitorId: string | null, candidates: ClusterCandidate[]): string | null {
  const tokens = titleTokens(title);
  for (const c of candidates) {
    if ((c.competitorId ?? null) !== (competitorId ?? null)) continue;
    if (isSameStory(tokens, titleTokens(c.title))) return c.duplicateOfId ?? c.id;
  }
  return null;
}

export const CLUSTER_WINDOW_HOURS = 72;
