import Link from "next/link";
import { CompanyLogo } from "@/components/CompanyLogo";
import { ARCHETYPES, marketingFor, type Marketing, type MarketedProduct } from "@/lib/marketing/extract";
import { siteFor, SITES } from "@/lib/marketing/sites";
import { db } from "@/lib/db";
import { ourCompany } from "@/lib/us";

const NET_LABEL: Record<string, string> = { broad: "Broad", national: "National", tiered: "Tiered", limited: "Limited", "system-anchored": "Health-system", regional: "Regional", unknown: "Network not stated" };
const NET_TONE: Record<string, string> = { limited: "bg-amber-50 text-amber-800", "system-anchored": "bg-violet-50 text-violet-800", tiered: "bg-sky-50 text-sky-800", broad: "bg-stone-100 text-stone-700", national: "bg-stone-100 text-stone-700", regional: "bg-stone-100 text-stone-700", unknown: "bg-stone-50 text-stone-400" };
const host = (u: string) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; } };
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

function Chip({ children, tone = "bg-stone-100 text-stone-700", title }: { children: React.ReactNode; tone?: string; title?: string }) {
  return <span title={title} className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>{children}</span>;
}

function ProductCard({ p }: { p: MarketedProduct }) {
  return (
    <div className="card space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-medium">{p.name}{p.family && p.family !== p.name ? <span className="ml-1 text-xs font-normal text-stone-500">· {p.family}</span> : null}</div>
        <div className="flex flex-wrap gap-1">
          {p.planType && <Chip>{p.planType}</Chip>}
          <Chip tone={NET_TONE[p.network]} title={p.networkDetail ?? undefined}>{NET_LABEL[p.network]}</Chip>
          {p.virtualFirst && <Chip tone="bg-emerald-50 text-emerald-800" title={p.virtualDetail ?? undefined}>Virtual-first</Chip>}
          {p.funding.map((f) => <Chip key={f} tone="bg-stone-50 text-stone-600">{f}</Chip>)}
        </div>
      </div>
      <div className="text-xs text-stone-500">{[p.segments.join(", "), p.states.join(" ")].filter(Boolean).join(" · ") || "Segments not stated"}{p.pcpRequired != null ? ` · ${p.pcpRequired ? "PCP required" : "no PCP needed"}` : ""}</div>
      {p.pitch && <p className="text-stone-800">{p.pitch}</p>}
      <dl className="grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[110px_1fr]">
        {p.networkDetail && <><dt className="text-stone-500">Network</dt><dd>{p.networkDetail}</dd></>}
        {p.virtualDetail && <><dt className="text-stone-500">Virtual care</dt><dd>{p.virtualDetail}</dd></>}
        {p.costDesign.length > 0 && <><dt className="text-stone-500">Cost design</dt><dd>{p.costDesign.join(" · ")}</dd></>}
        {p.targetBuyer && <><dt className="text-stone-500">Aimed at</dt><dd>{p.targetBuyer}</dd></>}
        {p.partners.length > 0 && <><dt className="text-stone-500">Partners</dt><dd>{p.partners.map((x, i) => <span key={x.name}>{i ? " · " : ""}{x.source ? <a href={x.source} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">{x.name}</a> : <span className="font-medium">{x.name}</span>}{x.role ? <span className="text-stone-500"> ({x.role})</span> : null}</span>)}</dd></>}
        {p.claims.length > 0 && <><dt className="text-stone-500">Claims</dt><dd><ul className="list-disc space-y-0.5 pl-4">{p.claims.slice(0, 5).map((c) => <li key={c}>{c}</li>)}</ul></dd></>}
      </dl>
      {(p.docs.length > 0 || p.sources.length > 0) && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-stone-100 pt-2 text-[11px]">
          {p.docs.slice(0, 4).map((d) => <a key={d.url} href={d.url} target="_blank" rel="noopener noreferrer" className="text-sky-700 hover:underline">📄 {d.title}</a>)}
          {p.sources.slice(0, 3).map((u) => <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="text-stone-500 hover:underline">{host(u)}{new URL(u).pathname.slice(0, 40)}</a>)}
        </div>
      )}
    </div>
  );
}

/** One carrier: how it structures and markets its commercial products, from its own pages and brochures. */
export async function CompetitorMarketing({ name }: { name: string }) {
  const site = siteFor(name);
  if (!site) return null;
  if (site.skip) return <section id="marketing" className="space-y-1"><h2 className="font-semibold tracking-tight">How they market it</h2><p className="text-sm text-stone-500">Not tracked: {site.skip}</p></section>;
  const m = await marketingFor(site.key, { generate: false });
  return (
    <section id="marketing" className="space-y-3">
      <div>
        <h2 className="font-semibold tracking-tight">How they market it</h2>
        <p className="text-xs text-stone-500">Read from {site.label}&apos;s own product pages, brochures and plan summaries{m ? ` (${m.pages} pages, ${m.pdfs} documents, crawled ${day(m.crawledAt)}; read by ${m.model})` : ""}. Refreshed monthly; links go to the source.</p>
      </div>
      {!m ? <p className="card p-4 text-sm text-stone-500">Not read yet: the monthly crawl of carrier product sites runs in the background (System status).</p> : <MarketingBody m={m} />}
    </section>
  );
}

function MarketingBody({ m }: { m: Marketing }) {
  return (
    <>
      <div className="card space-y-2 p-4 text-sm">
        <p>{m.summary}</p>
        {m.structure && <p className="text-stone-600"><span className="font-medium text-stone-800">How the line-up varies: </span>{m.structure}</p>}
        {m.positioning.length > 0 && <div className="flex flex-wrap gap-1.5">{m.positioning.map((t) => <Chip key={t} tone="bg-stone-900 text-white">{t}</Chip>)}</div>}
        {m.channels && <p className="text-xs text-stone-600"><span className="font-medium">Sells through: </span>{m.channels}</p>}
        {m.partners.length > 0 && <div className="text-xs text-stone-600"><span className="font-medium">Vendors and partners: </span>{m.partners.map((x, i) => <span key={x.name}>{i ? " · " : ""}{x.source ? <a href={x.source} target="_blank" rel="noopener noreferrer" className="font-medium text-stone-800 hover:underline">{x.name}</a> : <span className="font-medium text-stone-800">{x.name}</span>}{x.role ? ` (${x.role})` : ""}</span>)}</div>}
        {m.gaps && <p className="text-xs text-stone-400">Not clear from the pages: {m.gaps}</p>}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">{m.products.map((p) => <ProductCard key={p.name} p={p} />)}</div>
    </>
  );
}

/** Every tracked carrier's product archetypes side by side: who sells virtual-first, limited-network, tiered... */
export async function MarketingMatrix({ workspaceId }: { workspaceId: string }) {
  const [comps, us] = await Promise.all([db.competitor.findMany({ where: { workspaceId }, select: { id: true, name: true, tier: true } }), ourCompany(workspaceId)]);
  const rows: Array<{ id: string; name: string; isUs: boolean; m: Marketing | null; skip?: string }> = [];
  const seen = new Set<string>();
  for (const c of comps) {
    const s = siteFor(c.name);
    if (!s || seen.has(s.key)) continue;
    seen.add(s.key);
    rows.push({ id: c.id, name: c.name, isUs: c.id === us?.id, m: s.skip ? null : await marketingFor(s.key, { generate: false }), skip: s.skip });
  }
  rows.sort((a, b) => Number(b.isUs) - Number(a.isUs) || Number(!!b.m) - Number(!!a.m) || a.name.localeCompare(b.name));
  const read = rows.filter((r) => r.m);
  const mine = rows.find((r) => r.isUs)?.m ?? null;
  const has = (m: Marketing | null, k: string) => (m ? m.products.filter((p) => ARCHETYPES.find((a) => a.key === k)!.test(p)) : []);
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-semibold tracking-tight">How carriers build and sell their commercial products</h2>
        <p className="max-w-3xl text-xs text-stone-500">From each carrier&apos;s own product pages, brochures and plan summaries, crawled monthly and read by AI into product types. A product appears under a type only when the carrier&apos;s material says so (a plan that merely covers telehealth isn&apos;t virtual-first). {read.length} of {rows.length} carriers read. Open a carrier for its products, pitch and sources.</p>
      </div>
      {!read.length ? <p className="card p-4 text-sm text-stone-500">Not read yet: the monthly crawl of carrier product sites runs in the background (System status).</p> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-xs" data-static>
            <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500">
              <tr><th className="px-3 py-2">Carrier</th>{ARCHETYPES.map((a) => <th key={a.key} className="min-w-[110px] px-2 py-2">{a.label}</th>)}<th className="min-w-[220px] px-3 py-2">Main message</th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => (
                <tr key={r.id} className={`align-top ${r.isUs ? "bg-stone-50" : ""}`}>
                  <td className="max-w-[190px] px-3 py-2"><CompanyLogo id={r.id} name={r.name} size={16} className="mr-1.5 align-middle" /><Link href={`/competitors/${r.id}/products#marketing`} className="font-medium hover:underline">{r.name}</Link>{r.isUs && <span className="ml-1.5 rounded bg-stone-900 px-1 text-[10px] font-medium text-white">Us</span>}</td>
                  {r.m ? ARCHETYPES.map((a) => {
                    const ps = has(r.m, a.key);
                    const gap = !r.isUs && mine && ps.length > 0 && has(mine, a.key).length === 0;
                    return <td key={a.key} className={`px-2 py-2 ${gap ? "bg-amber-50" : ""}`} title={gap ? "They market this type; you don't" : undefined}>{ps.length ? ps.map((p) => <div key={p.name} className="leading-snug">{p.name}</div>) : <span className="text-stone-300">—</span>}</td>;
                  }) : <td colSpan={ARCHETYPES.length} className="px-2 py-2 text-stone-400">{r.skip ?? "Not read yet"}</td>}
                  <td className="min-w-[220px] max-w-[300px] px-3 py-2 text-stone-600">{r.m?.positioning.slice(0, 3).join(" · ") ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {mine && <p className="text-[10px] text-stone-400">Shaded: a type a competitor markets that your own material doesn&apos;t.</p>}
      <PartnerTable rows={read.map((r) => ({ id: r.id, name: r.name, isUs: r.isUs, m: r.m! }))} />
      <p className="text-[10px] text-stone-400">Sites crawled: {SITES.filter((s) => !s.skip).map((s) => s.label).join(", ")}.</p>
    </section>
  );
}

const norm = (n: string) => n.toLowerCase().replace(/[,.]|\b(inc|llc|health|healthcare|corp(oration)?|co|the)\b/g, " ").replace(/\s+/g, " ").trim();

/** Which vendors and partners each carrier uses, across products: shared vendors show who is buying the same capability. */
function PartnerTable({ rows }: { rows: Array<{ id: string; name: string; isUs: boolean; m: Marketing }> }) {
  const by = new Map<string, { name: string; uses: Array<{ id: string; carrier: string; isUs: boolean; role: string | null; products: string[]; source: string | null }> }>();
  for (const r of rows) {
    const all = [...r.m.partners.map((p) => ({ ...p, product: null as string | null })), ...r.m.products.flatMap((pr) => pr.partners.map((p) => ({ ...p, product: pr.name })))];
    for (const p of all) {
      const k = norm(p.name);
      if (!k) continue;
      const e = by.get(k) ?? by.set(k, { name: p.name, uses: [] }).get(k)!;
      let u = e.uses.find((x) => x.id === r.id);
      if (!u) { u = { id: r.id, carrier: r.name, isUs: r.isUs, role: p.role ?? null, products: [], source: p.source ?? null }; e.uses.push(u); }
      if (p.product && !u.products.includes(p.product)) u.products.push(p.product);
      u.role ??= p.role ?? null; u.source ??= p.source ?? null;
    }
  }
  const list = [...by.values()].sort((a, b) => b.uses.length - a.uses.length || a.name.localeCompare(b.name));
  if (!list.length) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold tracking-tight">Vendors and partners behind the products</h3>
      <p className="text-xs text-stone-500">Companies the carriers&apos; own material or partnership news names as working with them, and the products they&apos;re tied to. A vendor shared by several carriers is a capability anyone can buy; one used by a single competitor may be a differentiator.</p>
      <div className="card overflow-x-auto">
        <table className="w-full text-xs" data-static>
          <thead className="border-b border-stone-200 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500"><tr><th className="px-3 py-2">Vendor / partner</th><th className="px-3 py-2">What for</th><th className="px-3 py-2">Carriers · products</th></tr></thead>
          <tbody className="divide-y divide-stone-100">
            {list.map((v) => (
              <tr key={v.name} className="align-top">
                <td className="px-3 py-1.5 font-medium">{v.name}{v.uses.length > 1 && <span className="ml-1 text-[10px] font-normal text-stone-400">×{v.uses.length}</span>}</td>
                <td className="max-w-[260px] px-3 py-1.5 text-stone-600">{[...new Set(v.uses.map((u) => u.role).filter(Boolean))].slice(0, 2).join("; ")}</td>
                <td className="px-3 py-1.5">{v.uses.map((u, i) => <span key={u.id}>{i ? " · " : ""}<span className={u.isUs ? "font-semibold" : ""}>{u.source ? <a href={u.source} target="_blank" rel="noopener noreferrer" className="hover:underline">{u.carrier}</a> : u.carrier}{u.isUs ? " (you)" : ""}</span>{u.products.length ? <span className="text-stone-500"> ({u.products.join(", ")})</span> : null}</span>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
