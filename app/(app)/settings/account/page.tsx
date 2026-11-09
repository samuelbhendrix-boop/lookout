import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { IconPicker, InlineField, PasswordForm } from "@/components/IconPicker";
import { ActionButton } from "@/components/ActionButton";
import { ssoConfig } from "@/lib/sso";

export default async function AccountPage() {
  const session = (await getSession())!;
  const memberships = await db.membership.findMany({ where: { userId: session.userId }, include: { workspace: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="h1">Your account</h1>
          <p className="text-sm text-stone-500">{session.email}</p>
        </div>
        <ActionButton method="POST" path="/auth/logout" className="btn-ghost">Sign out</ActionButton>
      </div>
      <section className="card space-y-4 p-4">
        <div><p className="label">Icon</p><IconPicker path="/auth/me" icon={session.userIcon} name={session.name ?? session.email} /></div>
        <InlineField path="/auth/me" field="name" label="Display name (shown to your teammates)" value={session.name ?? ""} placeholder="Sam Hendrix" />
        <div><p className="label">Email</p><p className="text-sm">{session.email} <span className="text-xs text-stone-500">· your sign-in; ask an owner if it needs to change</span></p></div>
      </section>
      <section className="card space-y-3 p-4">
        <h2 className="font-semibold tracking-tight">Password</h2>
        {ssoConfig() && <p className="text-xs text-stone-500">Signing in with single sign-on? Your password is managed by your company, not here.</p>}
        <PasswordForm />
      </section>
      <section className="card p-4 text-sm">
        <h2 className="mb-2 font-semibold tracking-tight">Your workspaces</h2>
        <ul className="divide-y divide-stone-100">
          {memberships.map((m) => <li key={m.id} className="flex justify-between py-1.5"><span>{m.workspace.name}</span><span className="font-mono text-xs text-stone-500">{m.role.toLowerCase()}</span></li>)}
        </ul>
      </section>
    </div>
  );
}
