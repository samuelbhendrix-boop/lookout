"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, splitList } from "@/lib/client";
import { SIGNAL_TYPES } from "@/lib/validators";

/** Shared submit lifecycle: busy flag, error message, reset + refresh on success. */
function useSubmit(build: (f: Record<string, string>, fd: FormData) => [string, unknown]) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      const [path, body] = build(Object.fromEntries(fd) as Record<string, string>, fd);
      await api("POST", path, body);
      form.reset();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, onSubmit };
}

const Err = ({ e }: { e: string | null }) =>
  e ? <p className="col-span-full rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{e}</p> : null;

export function CompetitorForm() {
  const { busy, error, onSubmit } = useSubmit((f) => [
    "/competitors",
    { name: f.name, website: f.website, aliases: splitList(f.aliases), tier: Number(f.tier), notes: f.notes || undefined },
  ]);
  return (
    <form onSubmit={onSubmit} className="card grid gap-3 p-4 sm:grid-cols-4">
      <div className="sm:col-span-1"><label className="label">Name</label><input className="input" name="name" required /></div>
      <div className="sm:col-span-1"><label className="label">Website</label><input className="input" name="website" type="url" placeholder="https://" /></div>
      <div className="sm:col-span-1"><label className="label">Aliases</label><input className="input" name="aliases" placeholder="uhc, united" /></div>
      <div className="sm:col-span-1">
        <label className="label">Tier</label>
        <select className="input" name="tier" defaultValue="2">
          <option value="1">1 — primary</option><option value="2">2 — secondary</option><option value="3">3 — watch</option>
        </select>
      </div>
      <Err e={error} />
      <div className="sm:col-span-4 flex justify-end"><button className="btn" disabled={busy}>Add competitor</button></div>
    </form>
  );
}

export function SourceForm({ competitors }: { competitors: { id: string; name: string }[] }) {
  const { busy, error, onSubmit } = useSubmit((f) => [
    "/sources",
    { name: f.name, kind: "RSS", url: f.url, competitorId: f.competitorId || null, pollMinutes: Number(f.pollMinutes) },
  ]);
  return (
    <form onSubmit={onSubmit} className="card grid gap-3 p-4 sm:grid-cols-6">
      <div className="sm:col-span-2"><label className="label">Name</label><input className="input" name="name" required placeholder="Acme newsroom" /></div>
      <div className="sm:col-span-4"><label className="label">RSS / Atom URL</label><input className="input" name="url" type="url" required placeholder="https://…/feed" /></div>
      <div className="sm:col-span-3">
        <label className="label">Competitor</label>
        <select className="input" name="competitorId" defaultValue="">
          <option value="">General market — auto-attribute each item</option>
          {competitors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="label">Poll every</label>
        <select className="input" name="pollMinutes" defaultValue="60">
          <option value="15">15 min</option><option value="60">1 hour</option><option value="360">6 hours</option><option value="1440">daily</option>
        </select>
      </div>
      <div className="flex items-end sm:col-span-1"><button className="btn w-full" disabled={busy}>Add</button></div>
      <Err e={error} />
    </form>
  );
}

export function AlertForm({ competitors }: { competitors: { id: string; name: string }[] }) {
  const { busy, error, onSubmit } = useSubmit((f, fd) => [
    "/alerts",
    {
      name: f.name,
      mode: f.mode,
      webhookUrl: f.webhookUrl,
      minImportance: Number(f.minImportance),
      keywords: splitList(f.keywords ?? ""),
      types: fd.getAll("types"),
      competitorIds: fd.getAll("competitorIds"),
    },
  ]);
  return (
    <form onSubmit={onSubmit} className="card grid gap-3 p-4 sm:grid-cols-2">
      <div><label className="label">Rule name</label><input className="input" name="name" required placeholder="M&A on tier-1s" /></div>
      <div><label className="label">Slack / webhook URL</label><input className="input" name="webhookUrl" type="url" required placeholder="https://hooks.slack.com/…" /></div>
      <div>
        <label className="label">Competitors (none = all)</label>
        <select className="input h-28" name="competitorIds" multiple>
          {competitors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Types (none = all)</label>
        <select className="input h-28" name="types" multiple>
          {SIGNAL_TYPES.map((t) => <option key={t} value={t}>{t === "M_AND_A" ? "M&A" : t.toLowerCase()}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Delivery</label>
        <select className="input" name="mode" defaultValue="INSTANT">
          <option value="INSTANT">Instant — one message per signal</option>
          <option value="DIGEST_WEEKLY">Weekly digest — top 15, grouped by competitor</option>
        </select>
      </div>
      <div className="hidden sm:block" />
      <div><label className="label">Keywords, any of (optional)</label><input className="input" name="keywords" placeholder="medicare advantage, exit" /></div>
      <div>
        <label className="label">Min importance</label>
        <select className="input" name="minImportance" defaultValue="3">
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <Err e={error} />
      <div className="flex justify-end sm:col-span-2"><button className="btn" disabled={busy}>Create rule</button></div>
    </form>
  );
}

export function MemberForm() {
  const { busy, error, onSubmit } = useSubmit((f) => ["/members", { email: f.email, role: f.role }]);
  return (
    <form onSubmit={onSubmit} className="card grid gap-3 p-4 sm:grid-cols-4">
      <div className="sm:col-span-2"><label className="label">Email</label><input className="input" name="email" type="email" required /></div>
      <div>
        <label className="label">Role</label>
        <select className="input" name="role" defaultValue="ANALYST">
          <option value="ADMIN">admin</option><option value="ANALYST">analyst</option><option value="VIEWER">viewer</option>
        </select>
      </div>
      <div className="flex items-end"><button className="btn w-full" disabled={busy}>Add member</button></div>
      <Err e={error} />
    </form>
  );
}
