"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const KEEP = (n: string) => {
  const s = n.toLowerCase();
  if (!/\.(pdf|xlsx|xlsm|xls|csv)$/.test(s) || s.split("/").pop()!.startsWith("._")) return false;
  return !/access maps|drug|formulary|adverse tiering|data integrity|data consolidation|segregation|attestation|usage agreement|qis|av screenshots|prescriptiondrug|issuerurl|prov directory|unified_rate_review|unifiedratereview/.test(s);
};

/** Upload SERFF filing folders (as downloaded from SERFF Filing Access). Only the files we read are sent. */
export function SerffUpload() {
  const router = useRouter();
  const dir = useRef<HTMLInputElement>(null);
  const loose = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const send = async (list: FileList | null) => {
    if (!list?.length) return;
    const fd = new FormData();
    let n = 0, skipped = 0;
    for (const f of Array.from(list)) {
      const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      if (!KEEP(path) || f.size > 30e6) { skipped++; continue; }
      fd.append("f", f, path); n++;
    }
    if (!n) { setMsg("No SERFF filing files found in that selection."); return; }
    setBusy(true); setMsg(`Reading ${n} file${n === 1 ? "" : "s"} (${skipped} skipped: maps, formulary tools, attestations)…`);
    try {
      const r = await fetch("/api/serff/upload", { method: "POST", body: fd });
      const j = (await r.json()) as { error?: string; results?: Array<{ folder: string; ok: boolean; tracking?: string; access?: number; crosswalk?: number; error?: string }> };
      if (!r.ok) setMsg(j.error ?? `Upload failed (HTTP ${r.status})`);
      else setMsg(j.results!.map((x) => (x.ok ? `✓ ${x.tracking}: ${x.access} network-access rows, ${x.crosswalk} crosswalk rows` : `✗ ${x.folder}: ${x.error}`)).join("\n"));
      router.refresh();
    } catch (e) { setMsg(`Upload failed: ${(e as Error).message}`); }
    finally { setBusy(false); if (dir.current) dir.current.value = ""; if (loose.current) loose.current.value = ""; }
  };
  return (
    <div className="card space-y-2 p-4 text-sm">
      <div className="font-medium">Add filings</div>
      <p className="text-xs text-stone-500">Download a filing from SERFF Filing Access (the filing PDF plus its &quot;Supporting Document Attachments&quot;), then pick its folder, or a folder holding several filing folders. Maps, formulary tools and attestations are skipped; the rest is read and summarised.</p>
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => dir.current?.click()} className="rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Choose folder…</button>
        <button disabled={busy} onClick={() => loose.current?.click()} className="rounded bg-stone-100 px-3 py-1.5 text-xs hover:bg-stone-200 disabled:opacity-50">Choose files…</button>
        <input ref={dir} type="file" multiple hidden onChange={(e) => send(e.target.files)} {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />
        <input ref={loose} type="file" multiple hidden accept=".pdf,.xlsx,.xlsm,.xls,.csv" onChange={(e) => send(e.target.files)} />
      </div>
      {msg && <pre className="whitespace-pre-wrap rounded bg-stone-50 p-2 text-xs text-stone-700">{msg}</pre>}
    </div>
  );
}
