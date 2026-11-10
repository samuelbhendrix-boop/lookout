/**
 * Files a person fetched by hand in a browser (sites that refuse automated visits), dropped on the repo's GitHub
 * release "manual-mrf". The step-by-step guide is docs/MANUAL-MRF.md. Two ways in:
 *  1. Upload the file itself, named:
 *       hpt__<hospital-domain>__<anything>.json|csv|zip     a hospital's standard-charges file
 *       tic__<carrier>__<network>.json|json.gz|zip          a carrier's in-network rate file
 *       toc__<carrier>.json|json.gz                         a carrier's table-of-contents index (e.g. toc__bcbsma.json)
 *  2. Or add a line to links.txt (when the file's own link works, only the page around it is blocked):
 *       hpt <hospital-domain> <url>
 *       tic <carrier> <network words…> <url>
 *       toc <carrier> <url>
 */
const UA = { "User-Agent": "Mozilla/5.0 (compatible; PayersightBot; +https://github.com/samuelbhendrix-boop/lookout)" };
const REPO = process.env.GITHUB_REPOSITORY ?? "samuelbhendrix-boop/lookout";
export const MANUAL_RELEASE_URL = `https://github.com/${REPO}/releases/tag/manual-mrf`;

export type ManualFiles = {
  hpt: Array<{ domain: string; url: string; name: string }>;
  tic: Array<{ carrier: string; network: string; url: string }>;
  toc: Array<{ carrier: string; url: string }>;
};

export async function manualFiles(): Promise<ManualFiles> {
  const out: ManualFiles = { hpt: [], tic: [], toc: [] };
  const api = `https://api.github.com/repos/${REPO}/releases/tags/manual-mrf`;
  const base = { ...UA, accept: "application/vnd.github+json" };
  let res = await fetch(api, { headers: process.env.GITHUB_TOKEN ? { ...base, authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : base, signal: AbortSignal.timeout(30_000) });
  if (res.status === 401) res = await fetch(api, { headers: base, signal: AbortSignal.timeout(30_000) });
  if (res.status === 404) return out;
  if (!res.ok) throw new Error(`GitHub releases API: HTTP ${res.status}`);
  const rel = (await res.json()) as { assets: Array<{ name: string; browser_download_url: string }> };
  for (const a of rel.assets) {
    let m: RegExpExecArray | null;
    if ((m = /^hpt__([a-z0-9.-]+)__(.+)$/i.exec(a.name))) out.hpt.push({ domain: m[1].toLowerCase(), url: a.browser_download_url, name: a.name });
    else if ((m = /^tic__([a-z0-9_-]+)__(.+?)\.(json(\.gz)?|zip)$/i.exec(a.name))) out.tic.push({ carrier: m[1].toLowerCase(), network: m[2].replace(/[_-]+/g, " "), url: a.browser_download_url });
    else if ((m = /^toc__([a-z0-9_-]+)\.json(\.gz)?$/i.exec(a.name))) out.toc.push({ carrier: m[1].toLowerCase(), url: a.browser_download_url });
    else if (a.name === "links.txt") {
      const text = await (await fetch(a.browser_download_url, { headers: UA })).text();
      for (const line of text.split("\n")) {
        const p = line.trim().split(/\s+/);
        const url = p.at(-1) ?? "";
        if (!/^https:\/\//.test(url) || line.trim().startsWith("#")) continue;
        if (p[0] === "hpt" && p.length >= 3) out.hpt.push({ domain: p[1].toLowerCase(), url, name: url.split("/").pop()!.split("?")[0] });
        if (p[0] === "tic" && p.length >= 4) out.tic.push({ carrier: p[1].toLowerCase(), network: p.slice(2, -1).join(" "), url });
        if (p[0] === "toc" && p.length >= 3) out.toc.push({ carrier: p[1].toLowerCase(), url });
      }
    }
  }
  return out;
}
