/**
 * Finds the newest monthly GitHub release ("<prefix>-YYYY-MM") of this repo. Release assets download from fixed URLs,
 * so it probes this month's and the last two months' tags directly; the REST API is only the fallback, because it
 * allows 60 anonymous requests an hour per IP and Render's shared outbound IPs hit that (HTTP 403). `version` changes
 * whenever a release is republished, so a rebuilt extract reloads.
 */
export const REPO = "samuelbhendrix-boop/lookout";
const UA = { "User-Agent": "Mozilla/5.0 (compatible; PayersightBot; +https://github.com/samuelbhendrix-boop/lookout)" };
export type Asset = { name: string; browser_download_url: string; size?: number };
export type Release = { tag_name: string; html_url: string; version: string; assets: Asset[] };

const head = (url: string) => fetch(url, { method: "HEAD", headers: UA, redirect: "follow", signal: AbortSignal.timeout(30_000) }).catch(() => null);
const dl = (tag: string, name: string) => `https://github.com/${REPO}/releases/download/${tag}/${name}`;

/**
 * @param key   an asset every usable release has (e.g. "summary-code-rates.csv.gz")
 * @param also  other asset names to include when probing (e.g. "manifest.json")
 * @param numbered  for releases with numbered parts (hpt-0.ndjson.gz, hpt-1…): name of part i
 */
export async function findRelease(prefix: string, key: string, also: string[] = [], numbered?: (i: number) => string): Promise<Release | null> {
  // Direct download URLs first: no API, no rate limit.
  const now = new Date();
  for (const back of [0, 1, 2]) {
    const tag = `${prefix}-${new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString().slice(0, 7)}`;
    const h = await head(dl(tag, key));
    if (!h?.ok) continue;
    const assets: Asset[] = [{ name: key, browser_download_url: dl(tag, key) }, ...also.map((n) => ({ name: n, browser_download_url: dl(tag, n) }))];
    if (numbered) for (let i = 1; i < 64; i++) { const n = numbered(i); if (!(await head(dl(tag, n)))?.ok) break; assets.push({ name: n, browser_download_url: dl(tag, n) }); }
    return { tag_name: tag, html_url: `https://github.com/${REPO}/releases/tag/${tag}`, version: `${tag}@${h.headers.get("last-modified") ?? h.headers.get("etag") ?? ""}`, assets };
  }
  // Older releases (or a gap of months): ask the API.
  const re = new RegExp(`^${prefix}-\\d{4}-\\d{2}$`);
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers: { ...UA, accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) }, signal: AbortSignal.timeout(30_000) });
    if (res.ok) {
      const rels = (await res.json()) as Array<{ tag_name: string; html_url: string; published_at: string; assets: Asset[] }>;
      const r = rels.filter((x) => re.test(x.tag_name) && x.assets.some((a) => a.name === key)).sort((a, b) => b.tag_name.localeCompare(a.tag_name))[0];
      return r ? { tag_name: r.tag_name, html_url: r.html_url, version: `${r.tag_name}@${r.published_at}`, assets: r.assets } : null;
    }
  } catch { /* no release found */ }
  return null;
}
