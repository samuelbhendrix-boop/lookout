import Link from "next/link";
import { CompanyLogo } from "@/components/CompanyLogo";
import { productBrief, productNews } from "@/lib/productnews";
const when = (d: Date) => { const days = (Date.now() - d.getTime()) / 864e5; return days < 1 ? "today" : days < 30 ? `${Math.floor(days)}d ago` : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const THEME_TONE: Record<string, string> = {
  "Exits & withdrawals": "bg-red-50 text-red-800",
  "New plans & products": "bg-sky-50 text-sky-800",
  "Benefits & coverage": "bg-violet-50 text-violet-800",
  "Network products": "bg-amber-50 text-amber-800",
};

/**
 * Competitors' commercial product changes only: ranked news (exits, launches, benefit and network-product changes,
 * exchange moves) with an AI synthesis of what matters most when ANTHROPIC_API_KEY is set.
 */
export async function ProductNews({ workspaceId, limit = 8, compact = false, competitorId, days = 90 }: { workspaceId: string; limit?: number; compact?: boolean; competitorId?: string; days?: number }) {
  const items = await productNews(workspaceId, days, Math.max(limit, 15), competitorId);
  // The synthesis is for the cross-competitor view; one carrier's page gets its own strategy read instead.
  const brief = competitorId ? null : await productBrief(workspaceId, items);
  const shown = items.slice(0, limit);
  if (competitorId && !shown.length) return null;
  const byId = new Map(items.map((i) => [i.id, i]));
  return (
    <section className="card p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">{competitorId ? "Product news" : "Competitor product moves"} · {days} days</h2>
          <p className="text-[11px] text-stone-500">New, changed and withdrawn commercial products only (employer, small group, individual). Medicare, Medicaid, earnings, stock and executive news are left out.</p>
        </div>
        <Link href={`/updates?cat=product&days=${days}${competitorId ? `&competitorId=${competitorId}` : ""}`} className="shrink-0 text-xs text-stone-500 hover:text-stone-900">All product news →</Link>
      </div>

      {brief && brief.points.length > 0 && (
        <div className="mb-3 rounded-md border border-stone-200 bg-stone-50 p-3">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-stone-500">What matters most</p>
          <ul className="space-y-1.5 text-sm">
            {brief.points.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-stone-400">{i + 1}.</span>
                <span>{p.text}{" "}{p.ids.map((id, k) => byId.get(id) ? <Link key={id} href={`/signals/${id}`} className="text-xs text-stone-500 underline">[{k + 1}]</Link> : null)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[10px] text-stone-400">Synthesized by AI from the stories below; check the linked stories before acting on it.</p>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="text-sm text-stone-500">No {competitorId ? "" : "competitor "}product changes in the news in the last {days} days.</p>
      ) : (
        <ol className="divide-y divide-stone-100">
          {shown.map((i) => (
            <li key={i.id} className={compact ? "py-1.5" : "py-2"}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-stone-500">
                <span className={`rounded px-1.5 py-0.5 font-medium ${THEME_TONE[i.theme] ?? "bg-stone-100"}`}>{i.theme}</span>
                <CompanyLogo id={i.competitorId} name={i.competitor} size={14} className="mr-1 align-[-2px]" /><Link href={`/competitors/${i.competitorId}/products`} className="font-medium text-stone-700 hover:underline">{i.competitor}</Link>
                <span>{when(i.when)}</span>
                {i.outlets > 1 && <span>· {i.outlets} outlets</span>}
                {i.regional && <span>· New England</span>}
              </div>
              <Link href={`/signals/${i.id}`} className="text-sm font-medium leading-snug hover:underline">{i.title}</Link>
              {!compact && i.summary && !norm(i.summary).startsWith(norm(i.title).slice(0, 40)) && <p className="line-clamp-2 text-xs text-stone-500">{i.summary}</p>}
            </li>
          ))}
        </ol>
      )}
      {!process.env.ANTHROPIC_API_KEY && items.length > 1 && (
        <p className="mt-2 text-[10px] text-stone-400">Ranked by rules (kind of change, commercial and New England relevance, outlets covering it, recency). Add ANTHROPIC_API_KEY on the server for an AI synthesis on top.</p>
      )}
    </section>
  );
}
