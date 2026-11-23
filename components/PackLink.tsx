"use client";
import { useState } from "react";

/** Make, show once, and revoke the private link to the monthly pack. */
export function PackLink({ exists, createdAt, lastUsedAt, canManage }: { exists: boolean; createdAt: string | null; lastUsedAt: string | null; canManage: boolean }) {
  const [has, setHas] = useState(exists);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  async function call(method: "POST" | "DELETE") {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/pack/link", { method });
      const body = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "That didn't work. Try again.");
      if (method === "POST") { setUrl(`${window.location.origin}${body.path}`); setHas(true); } else { setUrl(null); setHas(false); }
    } catch (e) { setErr(e instanceof Error ? e.message : "That didn't work. Try again."); }
    setBusy(false);
  }
  return (
    <div className="space-y-3 text-sm">
      {url ? (
        <div className="space-y-2">
          <p className="font-medium">Your private link. Copy it now: it is shown only once.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly value={url} aria-label="Private link" onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded border border-stone-300 bg-stone-50 px-2 py-1.5 font-mono text-xs" />
            <button className="btn" onClick={() => { void navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy"}</button>
          </div>
        </div>
      ) : has ? (
        <p className="text-stone-600">A private link is active{createdAt ? `, made ${createdAt}` : ""}{lastUsedAt ? `, last used ${lastUsedAt}` : ", not used yet"}. For safety it can&apos;t be shown again; make a new one if you&apos;ve lost it.</p>
      ) : (
        <p className="text-stone-600">No private link yet.</p>
      )}
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" disabled={busy} onClick={() => call("POST")}>{has ? "Replace with a new link" : "Make a private link"}</button>
          {has && <button className="btn-ghost" disabled={busy} onClick={() => call("DELETE")}>Revoke link</button>}
        </div>
      ) : <p className="text-xs text-stone-500">Only a workspace admin can make or revoke the link.</p>}
      {has && !url && canManage && <p className="text-xs text-stone-500">Replacing the link stops the old one working straight away.</p>}
      {err && <p className="text-xs text-red-700">{err}</p>}
    </div>
  );
}
