"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";

/** Edit which legal entities in public filings count as this competitor (regex, case-insensitive). */
export function IssuerPatternEditor({ competitorId, pattern, custom }: { competitorId: string; pattern: string; custom: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(pattern);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(next: string | null) {
    setBusy(true);
    setMsg(null);
    try {
      await api("PATCH", `/competitors/${competitorId}`, { issuerPattern: next });
      setMsg("Saved");
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="label" htmlFor="pat">Filing-name match {custom ? "(custom)" : "(default)"}</label>
      <div className="flex flex-wrap gap-2">
        <input id="pat" className="input min-w-0 flex-1 font-mono text-xs" value={value} onChange={(e) => setValue(e.target.value)} />
        <button className="btn-ghost" disabled={busy || value === pattern} onClick={() => save(value)}>Save</button>
        {custom && <button className="btn-ghost" disabled={busy} onClick={() => save(null)}>Reset</button>}
      </div>
      <p className="text-xs text-stone-500">
        Separate alternatives with <code>|</code>, e.g. <code>harvard pilgrim|hphc|tufts associated</code>. Matching ignores case.
        {msg && <span className="ml-2 text-stone-700">{msg}</span>}
      </p>
    </div>
  );
}
