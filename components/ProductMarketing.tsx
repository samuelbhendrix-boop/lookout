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

const SEG_SHORT = (s: string) => (/large/i.test(s) ? "LG" : /small/i.test(s) ? "SG" : /individual|famil/i.test(s) ? "Ind" : /self|aso/i.test(s) ? "ASO" : /municipal|public/i.test(s) ? "Muni" : s);
const FUND_SHORT = (f: string) => (/level/i.test(f) ? "Level-funded" : /self|aso/i.test(f) ? "ASO" : /fully/i.test(f) ? "Fully insured" : f);
const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Employer plans, individual plans, and features/add-ons sold on top of plans. */
function groupOf(p: MarketedProduct): "employer" | "individual" | "addon" {
  if (/feature|add-?on|virtual care|program|rider|service/i.test(`${p.family ?? ""} ${p.name}`)) return "addon";
  const segs = p.segments.map(SEG_SHORT);
  const onlyIndividual = segs.length > 0 && segs.every((x) => x === "Ind");
  const exchangeFamily = /connector|individual & family|marketplace/i.test(p.family ?? "") && !segs.includes("LG");
  return onlyIndividual || exchangeFamily ? "individual" : "employer";
}
const GROUPS = [
  { key: "employer", label: "Employer plans" },
  { key: "individual", label: "Individual & family" },
  { key: "addon", label: "Features and add-ons" },
] as const;

function SourceLinks({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  return <span className="text-[11px] text-stone-400">{urls.slice(0, 4).map((u, i) => <a key={u} href={u} target="_blank" rel="noopener noreferrer" title={u} className="mr-2 text-sky-700 hover:underline">{/\.pdf/i.test(u) ? `PDF ${i + 1}` : host(u)}</a>)}</span>;
}

function ProductRow({ p }: { p: MarketedProduct }) {
  const segs = uniq(p.segments.map(SEG_SHORT));
  const funding = uniq(p.funding.map(FUND_SHORT));
  const links = uniq([...p.docs.map((d) => d.url), ...p.sources]);
  return (
    <details className="group border-t border-stone-100 first:border-t-0">
      <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 px-4 py-3 hover:bg-stone-50 md:grid-cols-[minmax(0,1fr)_120px_120px_150px_16px]">
        <div className="min-w-0">
          <div className="font-medium text-stone-900">{p.name}</div>
          {p.pitch && <div className="truncate text-xs text-stone-500 group-open:whitespace-normal group-open:text-stone-700" title={p.pitch}>{p.pitch}</div>}
        </div>
        <div className="hidden text-xs text-stone-600 md:block">{p.planType && p.planType !== "mixed" ? p.planType : "Several types"}</div>
        <div className="hidden md:block">{p.network !== "unknown" ? <Chip tone={NET_TONE[p.network]}>{NET_LABEL[p.network]}</Chip> : <span className="text-xs text-stone-300">—</span>}{p.virtualFirst && <Chip tone="ml-1 bg-emerald-50 text-emerald-800">Virtual-first</Chip>}</div>
        <div className="hidden text-xs text-stone-500 md:block">{segs.join(" · ")}{funding.length ? <div className="text-stone-400">{funding.join(" · ")}</div> : null}</div>
        <span className="text-stone-400 transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="grid gap-x-6 gap-y-2 bg-stone-50/60 px-4 pb-4 pt-1 text-xs md:grid-cols-[120px_1fr]">
        {p.networkDetail && <><div className="text-stone-500">Network</div><div>{p.networkDetail}</div></>}
        {p.virtualDetail && <><div className="text-stone-500">Virtual care</div><div>{p.virtualDetail}</div></>}
        {p.costDesign.length > 0 && <><div className="text-stone-500">Cost design</div><div>{p.costDesign.map(cap).join(" · ")}</div></>}
        {p.targetBuyer && <><div className="text-stone-500">Aimed at</div><div>{cap(p.targetBuyer)}</div></>}
        {p.claims.length > 0 && <><div className="text-stone-500">Claims</div><div>{p.claims.slice(0, 4).map((c) => <div key={c}>“{c}”</div>)}</div></>}
        {p.partners.length > 0 && <><div className="text-stone-500">Partners</div><div>{p.partners.map((x) => x.name).join(" · ")}</div></>}
        {(p.states.length > 0 || p.pcpRequired != null) && <><div className="text-stone-500">Where · PCP</div><div>{p.states.join(" ")}{p.pcpRequired != null ? ` · ${p.pcpRequired ? "PCP required" : "no PCP needed"}` : ""}</div></>}
        {links.length > 0 && <><div className="text-stone-500">Sources</div><div><SourceLinks urls={links} /></div></>}
      </div>
    </details>
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
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold tracking-tight">How they market it</h2>
        {m && <p className="text-xs text-stone-400">From their own site: {m.pages} pages, {m.pdfs} brochures and plan summaries · crawled {day(m.crawledAt)} · refreshed monthly</p>}
      </div>
      {!m ? <p className="card p-4 text-sm text-stone-500">Not read yet: the monthly crawl of carrier product sites runs in the background (System status).</p> : <MarketingBody m={m} />}
    </section>
  );
}

function MarketingBody({ m }: { m: Marketing }) {
  const groups = GROUPS.map((g) => ({ ...g, items: m.products.filter((p) => groupOf(p) === g.key) })).filter((g) => g.items.length);
  const partners = [...new Map(m.partners.map((x) => [x.name.toLowerCase(), x])).values()];
  return (
    <div className="space-y-4">
      {/* Overview: how the line-up is built, what they say, how they sell */}
      <div className="card grid gap-5 p-4 text-sm lg:grid-cols-3">
        <div className="space-y-1.5">
          <h3 className="font-mono text-[10px] uppercase tracking-wide text-stone-500">How the line-up is built</h3>
          <p className="leading-relaxed text-stone-800">{m.structure ?? m.summary}</p>
          {m.structure && <details className="text-xs text-stone-500"><summary className="cursor-pointer hover:text-stone-700">Full summary</summary><p className="mt-1 leading-relaxed">{m.summary}</p></details>}
        </div>
        <div className="space-y-1.5">
          <h3 className="font-mono text-[10px] uppercase tracking-wide text-stone-500">What they lead with</h3>
          <ul className="space-y-1">{m.positioning.slice(0, 5).map((t) => <li key={t} className="flex gap-2 leading-snug"><span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-stone-400" />{cap(t)}</li>)}</ul>
        </div>
        <div className="space-y-1.5">
          <h3 className="font-mono text-[10px] uppercase tracking-wide text-stone-500">How they sell</h3>
          <p className="line-clamp-6 leading-relaxed text-stone-700" title={m.channels ?? undefined}>{m.channels ?? "Not stated."}</p>
        </div>
      </div>

      {/* Products, grouped; click a row for the detail */}
      <div className="card overflow-hidden">
        <div className="hidden grid-cols-[minmax(0,1fr)_120px_120px_150px_16px] gap-x-4 border-b border-stone-200 px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-stone-500 md:grid"><span>Product · pitch</span><span>Plan type</span><span>Network</span><span>Segments · funding</span><span /></div>
        {groups.map((g) => (
          <div key={g.key}>
            <div className="border-b border-stone-100 bg-stone-50 px-4 py-1.5 text-[11px] font-medium text-stone-600">{g.label} <span className="font-normal text-stone-400">({g.items.length})</span></div>
            {g.items.map((p) => <ProductRow key={p.name} p={p} />)}
          </div>
        ))}
      </div>

      {/* Vendors and partners */}
      {partners.length > 0 && (
        <div className="card p-4 text-sm">
          <h3 className="mb-2 font-mono text-[10px] uppercase tracking-wide text-stone-500">Vendors and partners ({partners.length})</h3>
          <ul className="grid gap-x-6 gap-y-1.5 md:grid-cols-2">
            {partners.map((x) => {
              const news = /\(news\)/i.test(x.role ?? "") || /news\.google/.test(x.source ?? "");
              const role = (x.role ?? "").replace(/\s*\(news\)\s*/i, "");
              return (
                <li key={x.name} className="flex min-w-0 items-baseline gap-2">
                  {x.source ? <a href={x.source} target="_blank" rel="noopener noreferrer" className="shrink-0 font-medium text-stone-900 hover:underline">{x.name}</a> : <span className="shrink-0 font-medium">{x.name}</span>}
                  <span className="truncate text-xs text-stone-500" title={role}>{role}</span>
                  {news && <span className="shrink-0 rounded bg-stone-100 px-1 text-[10px] text-stone-500">news</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {m.gaps && <p className="text-[11px] text-stone-400">Not clear from their material: {m.gaps}</p>}
    </div>
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
