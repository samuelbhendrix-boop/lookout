"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "@/lib/client";
import { Avatar } from "./Avatar";

/** Shrinks an uploaded image to a 128 px square (center crop) so it's small enough to store. */
async function toIcon(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("Couldn't read that image")); i.src = url; });
    const side = Math.min(img.width, img.height);
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    c.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 128, 128);
    return c.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function IconPicker({ path, icon, name, square = false, disabled = false }: { path: string; icon: string | null; name: string; square?: boolean; disabled?: boolean }) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [emoji, setEmoji] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(next: string | null) {
    setBusy(true); setErr("");
    try { await api("PATCH", path, { icon: next }); router.refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Avatar icon={icon} name={name} size={48} square={square} />
      {!disabled && (
        <>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) save(await toIcon(f).catch((x) => { setErr(x.message); return icon; })); e.target.value = ""; }} />
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => file.current?.click()}>Upload image</button>
          <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); if (emoji.trim()) save(emoji.trim()); }}>
            <input className="input w-20" placeholder="or 🏢" value={emoji} maxLength={8} onChange={(e) => setEmoji(e.target.value)} aria-label="Emoji icon" />
            <button className="btn-ghost" disabled={busy || !emoji.trim()}>Use</button>
          </form>
          {icon && <button type="button" className="text-xs text-stone-500 hover:text-stone-900" disabled={busy} onClick={() => save(null)}>Remove</button>}
        </>
      )}
      {err && <p className="w-full text-xs text-red-600">{err}</p>}
    </div>
  );
}

/** One-field form that PATCHes { [field]: value } and refreshes. */
export function InlineField({ path, field, label, value, placeholder, minLength = 0 }: { path: string; field: string; label: string; value: string; placeholder?: string; minLength?: number }) {
  const router = useRouter();
  const [v, setV] = useState(value);
  const [state, setState] = useState<"idle" | "busy" | "saved">("idle");
  const [err, setErr] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => {
      e.preventDefault(); setState("busy"); setErr("");
      try { await api("PATCH", path, { [field]: v.trim() }); setState("saved"); router.refresh(); } catch (x) { setErr((x as Error).message); setState("idle"); }
    }}>
      <div className="min-w-[220px] flex-1"><label className="label">{label}</label><input className="input" value={v} placeholder={placeholder} minLength={minLength} onChange={(e) => { setV(e.target.value); setState("idle"); }} /></div>
      <button className="btn" disabled={state === "busy" || v.trim() === value}>{state === "saved" ? "Saved" : "Save"}</button>
      {err && <p className="w-full text-xs text-red-600">{err}</p>}
    </form>
  );
}

export function PasswordForm() {
  const [state, setState] = useState<"idle" | "busy">("idle");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form className="grid gap-3 sm:grid-cols-3" onSubmit={async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
      if (f.next !== f.confirm) return setMsg({ ok: false, text: "New passwords don't match" });
      setState("busy"); setMsg(null);
      try {
        const r = await api<{ signedOutOthers: number }>("POST", "/auth/password", { current: f.current, next: f.next });
        (e.target as HTMLFormElement).reset();
        setMsg({ ok: true, text: `Password changed${r.signedOutOthers ? `; signed out ${r.signedOutOthers} other session${r.signedOutOthers === 1 ? "" : "s"}` : ""}.` });
      } catch (x) { setMsg({ ok: false, text: (x as Error).message }); } finally { setState("idle"); }
    }}>
      <div><label className="label">Current password</label><input className="input" name="current" type="password" required autoComplete="current-password" /></div>
      <div><label className="label">New password</label><input className="input" name="next" type="password" required minLength={10} autoComplete="new-password" /></div>
      <div><label className="label">Confirm new password</label><input className="input" name="confirm" type="password" required minLength={10} autoComplete="new-password" /></div>
      <div className="flex items-center gap-3 sm:col-span-3">
        <button className="btn" disabled={state === "busy"}>Change password</button>
        {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}
