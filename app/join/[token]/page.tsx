import Link from "next/link";
import { Suspense } from "react";
import { getSession } from "@/lib/auth";
import { findUsableInvite } from "@/lib/invites";
import { AuthForm } from "@/components/AuthForm";
import { AcceptInvite } from "@/components/AcceptInvite";

export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await findUsableInvite(token);
  if (!invite)
    return (
      <Centered>
        <h1 className="h1 mb-2">Invite link not valid</h1>
        <p className="text-sm text-stone-500">It may have expired, been revoked, or hit its use limit. Ask a workspace admin for a fresh link.</p>
        <Link href="/login" className="btn mt-6">Go to sign in</Link>
      </Centered>
    );

  const session = await getSession();
  if (!session)
    return (
      <Suspense>
        <AuthForm mode="signup" inviteToken={token} joining={invite.workspace.name} />
      </Suspense>
    );

  return (
    <Centered>
      <h1 className="h1 mb-2">Join {invite.workspace.name}</h1>
      <p className="mb-6 text-sm text-stone-500">
        You&apos;re signed in as {session.email}. You&apos;ll join as <b>{invite.role.toLowerCase()}</b> unless you&apos;re already a member.
      </p>
      <AcceptInvite token={token} />
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
