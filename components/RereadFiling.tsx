"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function RereadFiling({ id, canReread }: { id: string; canReread: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div title={canReread ? undefined : "Added before its text was kept: this re-writes the summary from the first read. Upload it again for a full re-read."}>
      <button disabled={busy} onClick={async () => { setBusy(true); setErr(null); const r = await fetch(`/api/serff/${id}/reread`, { method: "POST" }); if (!r.ok) setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`); setBusy(false); router.refresh(); }} className="rounded bg-stone-100 px-2.5 py-1 text-[11px] text-stone-700 hover:bg-stone-200 disabled:opacity-50">{busy ? "Reading… (up to a minute)" : canReread ? "Re-read" : "Re-summarise"}</button>
      {err && <p className="mt-1 text-[11px] text-red-700">{err}</p>}
    </div>
  );
}
