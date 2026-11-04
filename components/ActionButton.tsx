"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";

/** Generic mutate-then-refresh button for row actions (delete, toggle, poll now). */
export function ActionButton({
  method,
  path,
  body,
  confirmText,
  children,
  className = "text-xs text-stone-500 hover:text-stone-900",
  doneText,
}: {
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  confirmText?: string;
  children: React.ReactNode;
  className?: string;
  doneText?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [err, setErr] = useState("");

  async function run() {
    if (confirmText && !confirm(confirmText)) return;
    setState("busy");
    try {
      await api(method, path, body);
      setState("done");
      router.refresh();
      setTimeout(() => setState("idle"), 2000);
    } catch (e) {
      setErr((e as Error).message);
      setState("error");
    }
  }

  return (
    <button onClick={run} disabled={state === "busy"} className={className} title={state === "error" ? err : undefined}>
      {state === "busy" ? "…" : state === "done" && doneText ? doneText : state === "error" ? "Failed" : children}
    </button>
  );
}
