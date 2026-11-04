import type { SignalStatus, SignalType } from "@prisma/client";

const TYPE_STYLE: Record<SignalType, string> = {
  PRICING: "bg-amber-100 text-amber-800",
  PRODUCT: "bg-sky-100 text-sky-800",
  NETWORK: "bg-emerald-100 text-emerald-800",
  REGULATORY: "bg-violet-100 text-violet-800",
  LEADERSHIP: "bg-pink-100 text-pink-800",
  M_AND_A: "bg-red-100 text-red-800",
  PARTNERSHIP: "bg-teal-100 text-teal-800",
  FINANCIAL: "bg-lime-100 text-lime-800",
  OTHER: "bg-stone-100 text-stone-600",
};

export function TypeBadge({ type }: { type: SignalType }) {
  return (
    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide ${TYPE_STYLE[type]}`}>
      {type === "M_AND_A" ? "M&A" : type}
    </span>
  );
}

export function StatusDot({ status }: { status: SignalStatus }) {
  const c = { NEW: "bg-accent", REVIEWED: "bg-stone-300", ESCALATED: "bg-red-600", ARCHIVED: "bg-stone-200" }[status];
  return <span title={status} className={`inline-block h-2 w-2 shrink-0 rounded-full ${c}`} />;
}

/** Five ticks, filled to importance — scannable at a glance in a dense feed. */
export function Importance({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5" title={`Importance ${value}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`h-3 w-1 rounded-sm ${i <= value ? (value >= 4 ? "bg-red-600" : "bg-stone-700") : "bg-stone-200"}`} />
      ))}
    </span>
  );
}

export function timeAgo(d: Date | string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(d).toLocaleDateString();
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-stone-500">{children}</div>}
    </div>
  );
}
