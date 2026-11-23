"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type Opt = { id: string; name: string; ready: boolean };

/** Pick a competitor, and optionally a second one to compare it with. */
export function StrategyPicker({ options, c, vs }: { options: Opt[]; c: string | null; vs: string | null }) {
  const router = useRouter();
  const go = (nc: string | null, nvs: string | null) => { const q = new URLSearchParams(); if (nc) q.set("c", nc); if (nc && nvs && nvs !== nc) q.set("vs", nvs); router.push(`/competitors/strategy${q.size ? `?${q}` : ""}`); };
  const sel = "rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm";
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs text-stone-500">Competitor
        <select className={`${sel} mt-1 block min-w-56`} value={c ?? ""} onChange={(e) => go(e.target.value || null, vs)}>
          <option value="">All competitors</option>
          {options.map((o) => <option key={o.id} value={o.id} disabled={!o.ready}>{o.name}{o.ready ? "" : " (not written yet)"}</option>)}
        </select>
      </label>
      <label className="text-xs text-stone-500">Compare with
        <select className={`${sel} mt-1 block min-w-56`} value={vs ?? ""} disabled={!c} onChange={(e) => go(c, e.target.value || null)}>
          <option value="">{c ? "No comparison" : "Pick a competitor first"}</option>
          {options.filter((o) => o.id !== c).map((o) => <option key={o.id} value={o.id} disabled={!o.ready}>{o.name}{o.ready ? "" : " (not written yet)"}</option>)}
        </select>
      </label>
      {c && vs && <button className="btn-ghost text-xs" onClick={() => go(vs, c)}>Swap</button>}
      {c && <button className="btn-ghost text-xs" onClick={() => go(null, null)}>Back to all</button>}
    </div>
  );
}

/** Start a rewrite, then refresh the page while it is being written (about a minute). */
export function WriteRead({ id, has, writing }: { id: string; has: boolean; writing: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "writing" | "error">(writing ? "writing" : "idle");
  const [err, setErr] = useState("");
  useEffect(() => {
    if (state !== "writing") return;
    let n = 0;
    const t = setInterval(() => { n++; router.refresh(); if (n >= 12) { clearInterval(t); setState("idle"); } }, 15_000);
    return () => clearInterval(t);
  }, [state, router]);
  useEffect(() => { if (!writing && state === "writing") setState("idle"); }, [writing]); // eslint-disable-line react-hooks/exhaustive-deps
  async function run() {
    try { await api("POST", `/competitors/${id}/strategy`); setState("writing"); } catch (e) { setErr((e as Error).message); setState("error"); }
  }
  if (state === "writing") return <span className="text-xs text-stone-500">Writing, about a minute…</span>;
  return <button onClick={run} className="btn-ghost text-xs" title={state === "error" ? err : undefined}>{state === "error" ? "Couldn't start. Try again" : has ? "Rewrite" : "Write now"}</button>;
}
