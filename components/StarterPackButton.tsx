"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";

/** One-click seeding of competitors + sources. Safe to press twice (server skips duplicates). */
export function StarterPackButton({ pack = "ma-commercial-payers", label = "Load Massachusetts payer starter pack" }: { pack?: string; label?: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setState("busy");
    setMsg(null);
    try {
      const r = await api<{ competitors: number; sources: number }>("POST", "/starter-pack", { pack });
      setMsg(`Added ${r.competitors} competitors and ${r.sources} sources. First signals arrive in a few minutes — refresh the feed.`);
      setState("done");
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
      setState("idle");
    }
  }

  return (
    <div className="space-y-2">
      <button className="btn" onClick={load} disabled={state !== "idle"}>
        {state === "busy" ? "Loading…" : state === "done" ? "Loaded ✓" : label}
      </button>
      {msg && <p className="text-sm text-stone-600">{msg}</p>}
    </div>
  );
}
