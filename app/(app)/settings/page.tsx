import { rateDatasetLabel } from "@/lib/marketdata/mrf/files";
import { getSession, hasRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { MemberForm } from "@/components/forms";
import { ActionButton } from "@/components/ActionButton";
import { InviteManager } from "@/components/InviteManager";
import { DATASETS } from "@/lib/marketdata/datasets";
import { ssoConfig } from "@/lib/sso";

export default async function SettingsPage() {
  const session = (await getSession())!;
  const isAdmin = hasRole(session.role, "ADMIN");
  const imports = await db.dataImport.findMany();
  const [members, invites] = await Promise.all([
    db.membership.findMany({
      where: { workspaceId: session.workspaceId },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { email: true, name: true } } },
    }),
    isAdmin
      ? db.invite.findMany({
          where: { workspaceId: session.workspaceId, revokedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
          select: { id: true, role: true, uses: true, maxUses: true, expiresAt: true },
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="h1">Settings</h1>
          <p className="text-sm text-stone-500">{session.workspaceName}</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && <a href="/status" className="btn-ghost">System status</a>}
          <ActionButton method="POST" path="/auth/logout" className="btn-ghost">Sign out</ActionButton>
        </div>
      </div>
      {isAdmin && (
        <>
          <h2 className="font-mono text-xs uppercase tracking-wide text-stone-500">Invite links</h2>
          <InviteManager invites={invites.map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString() }))} />
        </>
      )}
      <h2 className="font-mono text-xs uppercase tracking-wide text-stone-500">Members ({members.length})</h2>
      {isAdmin && <MemberForm />}
      <ul className="card divide-y divide-stone-100">
        {members.map((m) => (
          <li key={m.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <span>{m.user.name ?? m.user.email} <span className="text-stone-400">{m.user.name ? m.user.email : ""}</span></span>
            <span className="font-mono text-xs text-stone-500">{m.role.toLowerCase()}</span>
          </li>
        ))}
      </ul>
      <h2 className="font-mono text-xs uppercase tracking-wide text-stone-500">Sign-in &amp; backups</h2>
      <div className="card space-y-2 p-4 text-sm text-stone-600">
        <p>
          Single sign-on: {ssoConfig() ? <span className="text-emerald-700">on ({ssoConfig()!.issuer})</span> : <span>off — set OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET to enable (works with Microsoft Entra, Google Workspace, Okta).</span>}
        </p>
        <p>
          Database backups: Render keeps point-in-time recovery for the paid Postgres (restore from the database&apos;s Recovery page) and can make
          logical exports on demand. {hasRole(session.role, "OWNER") && <>Workspace-only backup: <a className="underline" href="/api/v1/admin/export">download JSON</a> (competitors, sources, signals, alert rules, members).</>}
        </p>
      </div>
      <h2 className="font-mono text-xs uppercase tracking-wide text-stone-500">Market data</h2>
      <div className="card p-4 text-sm">
        <p className="mb-3 text-stone-600">
          Public data, imported automatically and refreshed monthly: CMS rate filings (products, plans, SERFF numbers) and loss ratio
          reports; MA CHIA enrollment including self-insured; and Maine, Rhode Island and New Hampshire large-group reports.
        </p>
        <ul className="divide-y divide-stone-100">
          {DATASETS.map((d) => {
            const i = imports.find((x) => x.dataset === d.dataset && x.year === d.year);
            return (
              <li key={`${d.dataset}${d.year}`} className="flex items-center justify-between py-1.5">
                <span>{({ urrt: "CMS rate filings", mlr: "CMS loss ratio reports", ma_chia: "MA CHIA enrollment (incl. self-insured)", state_snapshots: "ME / RI / NH large group", dol_5500: "DOL Form 5500 employer plans", tic: "Transparency in Coverage indexes", rates: "Negotiated rates" } as Record<string, string>)[d.dataset] ?? d.dataset}{d.dataset === "rates" ? ` · ${rateDatasetLabel(d.year).replace("Negotiated rates — ", "")}` : ` · ${d.dataset === "state_snapshots" ? "v" : ""}${d.year}`}</span>
                <span className={`font-mono text-xs ${i?.status === "failed" ? "text-red-600" : "text-stone-500"}`}>
                  {!i ? "waiting" : i.status === "done" && i.finishedAt && i.finishedAt.getTime() > 0 ? `${i.rows.toLocaleString()} rows · ${i.finishedAt.toISOString().slice(0, 10)}` : i.status === "failed" ? `failed: ${i.error?.slice(0, 60)}` : i.status}
                </span>
              </li>
            );
          })}
        </ul>
        {isAdmin && (
          <div className="mt-3">
            <ActionButton method="POST" path="/market-data" doneText="Re-import queued" className="btn-ghost">Re-import all</ActionButton>
          </div>
        )}
      </div>
      <div className="card p-4 text-sm text-stone-600">
        <p className="font-medium text-stone-900">Roles</p>
        <p className="mt-1">Viewer reads · Analyst triages, logs signals, manages competitors & sources · Admin manages alerts, members, deletes · Owner is the creator.</p>
      </div>
    </div>
  );
}
