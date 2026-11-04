"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";

export function CommentForm({ signalId }: { signalId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api("POST", `/signals/${signalId}/comments`, { body });
      setBody("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 flex gap-2">
      <textarea
        className="input"
        rows={2}
        placeholder="So what? Implications, who should know, next step…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <button className="btn self-end" disabled={busy || !body.trim()}>Post</button>
    </form>
  );
}
