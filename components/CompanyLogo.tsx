"use client";
import { useState } from "react";

/** A competitor's logo (its site icon), falling back to initials when there isn't one. */
export function CompanyLogo({ id, name, size = 20, className = "" }: { id: string; name: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const initials = name.replace(/\(.*?\)/g, "").split(/[\s&-]+/).filter((w) => /^[A-Z0-9]/.test(w)).slice(0, 2).map((w) => w[0]).join("") || name[0];
  if (failed) return <span className={`inline-flex shrink-0 items-center justify-center rounded bg-stone-200 font-semibold text-stone-600 ${className}`} style={{ width: size, height: size, fontSize: Math.max(8, size * 0.42) }} aria-hidden>{initials}</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/api/logo/${id}`} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} className={`inline-block shrink-0 rounded bg-white object-contain ${className}`} style={{ width: size, height: size }} />;
}
