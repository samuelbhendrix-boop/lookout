"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SignalStatus, SignalType } from "@prisma/client";
import { api, splitList } from "@/lib/client";
import { SIGNAL_STATUSES, SIGNAL_TYPES } from "@/lib/validators";

type Props = {
  signal: { id: string; status: SignalStatus; type: SignalType; importance: number; competitorId: string | null; tags: string[] };
  competitors: { id: string; name: string }[];
  canDelete: boolean;
};

export function SignalEditor({ signal, competitors, canDelete }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      await api("PATCH", `/signals/${signal.id}`, {
        status: f.status,
        type: f.type,
        importance: Number(f.importance),
        competitorId: f.competitorId || null,
        tags: splitList(f.tags),
      });
      setMsg("Saved");
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this signal permanently?")) return;
    await api("DELETE", `/signals/${signal.id}`);
    router.replace("/updates");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card sticky top-6 space-y-3 p-4">
      <h2 className="font-mono text-xs uppercase tracking-wide text-stone-500">Triage</h2>
      <div>
        <label className="label">Status</label>
        <select className="input" name="status" defaultValue={signal.status}>
          {SIGNAL_STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Type</label>
        <select className="input" name="type" defaultValue={signal.type}>
          {SIGNAL_TYPES.map((t) => <option key={t} value={t}>{t === "M_AND_A" ? "M&A" : t.toLowerCase()}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Importance</label>
        <select className="input" name="importance" defaultValue={signal.importance}>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Competitor</label>
        <select className="input" name="competitorId" defaultValue={signal.competitorId ?? ""}>
          <option value="">Unattributed</option>
          {competitors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Tags</label>
        <input className="input" name="tags" defaultValue={signal.tags.join(", ")} />
      </div>
      <button className="btn w-full" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      {msg && <p className="text-center text-xs text-stone-500">{msg}</p>}
      {canDelete && (
        <button type="button" onClick={remove} className="w-full text-xs text-red-600 hover:underline">Delete signal</button>
      )}
    </form>
  );
}
