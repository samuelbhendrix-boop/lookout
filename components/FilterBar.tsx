"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type FilterDef = { key: string; label: string; options: Array<{ value: string; label: string }> };

/** A row of dropdown filters kept in the URL (so a filtered view can be bookmarked or shared). */
export function FilterBar({ filters, anchor }: { filters: FilterDef[]; anchor?: string }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const set = (key: string, value: string) => {
    const q = new URLSearchParams(sp.toString());
    if (value) q.set(key, value); else q.delete(key);
    router.push(`${path}${q.size ? `?${q}` : ""}${anchor ? `#${anchor}` : ""}`, { scroll: !anchor });
  };
  const active = filters.filter((f) => sp.get(f.key));
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {filters.map((f) => (
        <label key={f.key} className="flex items-center gap-1">
          <span className="whitespace-nowrap text-stone-500">{f.label}</span>
          <select value={sp.get(f.key) ?? ""} onChange={(e) => set(f.key, e.target.value)} className={`input h-7 max-w-[220px] py-0 text-xs ${sp.get(f.key) ? "border-stone-900" : ""}`}>
            <option value="">All</option>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      ))}
      {active.length > 0 && <button className="text-stone-500 underline" onClick={() => { const q = new URLSearchParams(sp.toString()); for (const f of filters) q.delete(f.key); router.push(`${path}${q.size ? `?${q}` : ""}`); }}>Clear filters</button>}
    </div>
  );
}
