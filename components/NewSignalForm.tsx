"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, splitList } from "@/lib/client";
import { SIGNAL_TYPES } from "@/lib/validators";

/** Manual intel entry — field notes, broker chatter, a link someone pasted in Slack. */
export function NewSignalForm({ competitors }: { competitors: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      await api("POST", "/signals", {
        title: f.title,
        url: f.url || undefined,
        summary: f.summary || undefined,
        competitorId: f.competitorId || undefined,
        type: f.type || undefined, // blank → classifier
        importance: f.importance ? Number(f.importance) : undefined,
        tags: splitList(f.tags ?? ""),
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return <button className="btn" onClick={() => setOpen(true)}>+ Log signal</button>;

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center bg-stone-900/30 p-4 pt-16" onClick={() => setOpen(false)}>
      <form onSubmit={onSubmit} onClick={(e) => e.stopPropagation()} className="card w-full max-w-lg space-y-3 p-5 shadow-xl">
        <h2 className="font-semibold">Log a signal</h2>
        <div><label className="label">Headline</label><input className="input" name="title" required autoFocus /></div>
        <div><label className="label">Link</label><input className="input" name="url" type="url" placeholder="https://…" /></div>
        <div><label className="label">What happened / why it matters</label><textarea className="input" name="summary" rows={3} /></div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="label">Competitor</label>
            <select className="input" name="competitorId" defaultValue="">
              <option value="">Auto-detect</option>
              {competitors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input" name="type" defaultValue="">
              <option value="">Auto</option>
              {SIGNAL_TYPES.map((t) => <option key={t} value={t}>{t === "M_AND_A" ? "M&A" : t.toLowerCase()}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Importance</label>
            <select className="input" name="importance" defaultValue="">
              <option value="">Auto</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
        <div><label className="label">Tags</label><input className="input" name="tags" placeholder="medicare, northeast" /></div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </div>
  );
}
