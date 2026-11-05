import type { ReactNode } from "react";

/** Standard "what this view leaves out" disclosure. Every data view that drops, filters or can't reach data uses it. */
export function NotIncluded({ items, title = "Not included" }: { items: ReactNode[]; title?: string }) {
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return (
    <details className="rounded-md border border-dashed border-stone-300 px-3 py-2 text-xs text-stone-600">
      <summary className="cursor-pointer font-medium text-stone-700">{title} <span className="font-normal text-stone-400">({shown.length})</span></summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">{shown.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </details>
  );
}
