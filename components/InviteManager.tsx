"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import { ActionButton } from "./ActionButton";

type Invite = { id: string; role: string; uses: number; maxUses: number; expiresAt: string };

/** Mint shareable join links; the URL is shown once, right after creation. */
export function InviteManager({ invites }: { invites: Invite[] }) {
  const router = useRouter();
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ url: string }>("POST", "/invites", { role: f.role, days: Number(f.days) });
      setUrl(res.url);
      setCopied(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      /* clipboard blocked — the field is selectable */
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={create} className="card grid gap-3 p-4 sm:grid-cols-4">
        <div>
          <label className="label">Role</label>
          <select className="input" name="role" defaultValue="ANALYST">
            <option value="ADMIN">admin</option><option value="ANALYST">analyst</option><option value="VIEWER">viewer</option>
          </select>
        </div>
        <div>
          <label className="label">Expires in</label>
          <select className="input" name="days" defaultValue="7">
            <option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option>
          </select>
        </div>
        <div className="flex items-end sm:col-span-2"><button className="btn w-full" disabled={busy}>Create invite link</button></div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-4">{error}</p>}
        {url && (
          <div className="flex gap-2 sm:col-span-4">
            <input className="input font-mono text-xs" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn-ghost shrink-0" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          </div>
        )}
        {url && <p className="text-xs text-stone-500 sm:col-span-4">Shown once. Anyone with the link can join until it expires or you revoke it.</p>}
      </form>
      {invites.length > 0 && (
        <ul className="card divide-y divide-stone-100 text-sm">
          {invites.map((i) => (
            <li key={i.id} className="flex items-center justify-between px-4 py-2">
              <span>
                <span className="font-mono text-xs">{i.role.toLowerCase()}</span>{" "}
                <span className="text-stone-500">· {i.uses}/{i.maxUses} used · expires {new Date(i.expiresAt).toLocaleDateString()}</span>
              </span>
              <ActionButton method="DELETE" path={`/invites/${i.id}`} confirmText="Revoke this link?" className="text-xs text-red-600 hover:underline">Revoke</ActionButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
