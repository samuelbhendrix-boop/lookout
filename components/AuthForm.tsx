"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";

export function AuthForm({ mode, inviteToken, joining }: { mode: "login" | "signup"; inviteToken?: string; joining?: string }) {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/feed";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form: Record<string, FormDataEntryValue> = Object.fromEntries(new FormData(e.currentTarget));
    if (inviteToken) form.inviteToken = inviteToken;
    try {
      await api("POST", `/auth/${mode}`, form);
      router.replace(next.startsWith("/") ? next : "/feed");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-accent" />
          <span className="font-mono text-sm font-medium tracking-widest">LOOKOUT</span>
        </div>
        <h1 className="h1 mb-1">{mode === "login" ? "Sign in" : joining ? `Join ${joining}` : "Create your workspace"}</h1>
        <p className="mb-6 text-sm text-stone-500">
          {mode === "login" ? "Competitor signals, triaged." : joining ? "Create your account to accept the invite." : "One workspace per team. Invite others after."}
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          {mode === "signup" && (
            <>
              <div>
                <label className="label" htmlFor="name">Your name</label>
                <input className="input" id="name" name="name" autoComplete="name" />
              </div>
              {!inviteToken && (
                <div>
                  <label className="label" htmlFor="workspaceName">Team / company</label>
                  <input className="input" id="workspaceName" name="workspaceName" required minLength={2} />
                </div>
              )}
            </>
          )}
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input className="input" id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input
              className="input"
              id="password"
              name="password"
              type="password"
              required
              minLength={mode === "signup" ? 10 : 1}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button className="btn w-full" disabled={busy}>
            {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
        <p className="mt-6 text-sm text-stone-500">
          {mode === "login" ? (
            <>No account? <Link className="underline" href="/signup">Sign up</Link></>
          ) : (
            <>Have an account? <Link className="underline" href={inviteToken ? `/login?next=/join/${inviteToken}` : "/login"}>Sign in</Link></>
          )}
        </p>
      </div>
    </div>
  );
}
