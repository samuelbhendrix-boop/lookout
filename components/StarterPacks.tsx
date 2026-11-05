"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";

type Pack = { id: string; name: string; description: string; competitors: number; loaded: boolean };

/** Pick-and-load starter packs. Packs overlap safely: shared carriers merge, duplicate sources are skipped. */
export function StarterPacks({ packs }: { packs: Pack[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});

  async function load(id: string) {
    setBusy(id);
    try {
      const r = await api<{ competitors: number; sources: number }>("POST", "/starter-pack", { pack: id });
      setMsg((m) => ({ ...m, [id]: `+${r.competitors} competitors, +${r.sources} sources — signals arrive within minutes` }));
      router.refresh();
    } catch (e) {
      setMsg((m) => ({ ...m, [id]: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-2 text-left sm:grid-cols-2">
      {packs.map((p) => (
        <div key={p.id} className="card flex items-start justify-between gap-3 p-3">
          <div className="min-w-0">
            <p className="font-medium">
              {p.name} <span className="font-mono text-xs text-stone-400">{p.competitors} cos.</span>
            </p>
            <p className="text-xs text-stone-500">{msg[p.id] ?? p.description}</p>
          </div>
          {p.loaded && !msg[p.id] ? (
            <span className="shrink-0 rounded bg-stone-100 px-2 py-1 text-xs text-stone-500">Loaded</span>
          ) : (
            <button className="btn shrink-0" disabled={busy !== null || !!msg[p.id]} onClick={() => load(p.id)}>
              {busy === p.id ? "Loading…" : msg[p.id] ? "✓" : "Load"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
