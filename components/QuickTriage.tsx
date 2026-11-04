"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { SignalStatus } from "@prisma/client";
import { api } from "@/lib/client";

/** One-click triage from the feed. Optimism isn't needed — the refresh is fast and authoritative. */
export function QuickTriage({ id, status }: { id: string; status: SignalStatus }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (s: SignalStatus) =>
    start(async () => {
      await api("PATCH", `/signals/${id}`, { status: s });
      router.refresh();
    });

  return (
    <div className={`flex gap-1 text-xs ${pending ? "opacity-40" : ""}`}>
      {status !== "REVIEWED" && <button disabled={pending} onClick={() => set("REVIEWED")} className="rounded px-1.5 py-0.5 text-stone-500 hover:bg-stone-100 hover:text-stone-900" title="Mark reviewed">✓</button>}
      {status !== "ESCALATED" && <button disabled={pending} onClick={() => set("ESCALATED")} className="rounded px-1.5 py-0.5 text-stone-500 hover:bg-red-50 hover:text-red-700" title="Escalate">↑</button>}
      {status !== "ARCHIVED" && <button disabled={pending} onClick={() => set("ARCHIVED")} className="rounded px-1.5 py-0.5 text-stone-500 hover:bg-stone-100 hover:text-stone-900" title="Archive">✕</button>}
    </div>
  );
}
