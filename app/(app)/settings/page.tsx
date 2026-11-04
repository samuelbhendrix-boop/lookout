import { getSession, hasRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { MemberForm } from "@/components/forms";
import { ActionButton } from "@/components/ActionButton";
import { InviteManager } from "@/components/InviteManager";

export default async function SettingsPage() {
  const session = (await getSession())!;
  const isAdmin = hasRole(session.role, "ADMIN");
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
        <ActionButton method="POST" path="/auth/logout" className="btn-ghost">Sign out</ActionButton>
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
      <div className="card p-4 text-sm text-stone-600">
        <p className="font-medium text-stone-900">Roles</p>
        <p className="mt-1">Viewer reads · Analyst triages, logs signals, manages competitors & sources · Admin manages alerts, members, deletes · Owner is the creator.</p>
      </div>
    </div>
  );
}
