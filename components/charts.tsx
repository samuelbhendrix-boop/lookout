/** Tiny server-rendered charts — no client JS, no chart library. */

export function Sparkline({ values, width = 96, height = 24, stroke = "currentColor" }: { values: Array<number | null>; width?: number; height?: number; stroke?: string }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p) => p.v !== null) as Array<{ v: number; i: number }>;
  if (pts.length < 2) return <span className="inline-block text-xs text-stone-300" style={{ width }}>—</span>;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * (width - 4) + 2;
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="inline-block align-middle" aria-hidden>
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r={2} fill={stroke} />
    </svg>
  );
}

export function ShareBar({ share, highlight }: { share: number; highlight?: boolean }) {
  return (
    <div className="h-2 w-full rounded-full bg-stone-100">
      <div className={`h-2 rounded-full ${highlight ? "bg-accent" : "bg-stone-500"}`} style={{ width: `${Math.max(0.5, share * 100)}%` }} />
    </div>
  );
}

// ─── formatting ──────────────────────────────────────────────────────

export const fmtInt = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
export const fmtMoneyM = (n: number | null | undefined) =>
  n == null ? "—" : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`;
export const fmtPct = (n: number | null | undefined, digits = 1) => (n == null ? "—" : `${(n * 100).toFixed(digits)}%`);
export const fmtSignedPct = (n: number | null | undefined, digits = 1) =>
  n == null ? "—" : `${n > 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;
export const fmtUsd = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);

export const SEGMENT_LABEL = { INDIVIDUAL: "Individual", SMALL_GROUP: "Small group", LARGE_GROUP: "Large group" } as const;

/** Loss ratio colouring: <80% (rebate territory) amber, >100% (losing money on claims) red. */
export const lrClass = (lr: number | null) => (lr == null ? "" : lr > 1 ? "text-red-600" : lr < 0.8 ? "text-amber-700" : "");
export const deltaClass = (d: number | null) => (d == null ? "text-stone-400" : d > 0 ? "text-emerald-700" : d < 0 ? "text-red-600" : "text-stone-500");
