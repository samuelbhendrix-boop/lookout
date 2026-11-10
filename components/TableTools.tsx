"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Makes every table in the app sortable (click a column header; again to reverse) and, from 6 rows up, filterable (a
 * search box above it that hides non-matching rows). Works on the rendered DOM, so every page's tables get it without
 * changes. Opt out with data-static on a table. Numbers sort as numbers: "$1.2K", "+4.5%", "1,234", "—" (last).
 */
const ENHANCED = "data-tt";

function value(cell: Element | undefined): number | string | null {
  if (!cell) return null;
  const raw = (cell.getAttribute("data-sort") ?? cell.textContent ?? "").trim();
  if (!raw || raw === "—" || raw === "-") return null;
  const m = /^([+\-−]?)\$?([\d,]*\.?\d+)\s*([KMB])?\s*%?/.exec(raw.replace(/^[<>~≈]/, ""));
  if (m && /^[+\-−$\d.]/.test(raw.replace(/^[<>~≈]/, ""))) {
    const n = Number(m[2].replace(/,/g, "")) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[3] as "K" | "M" | "B"] ?? 1);
    return m[1] === "-" || m[1] === "−" ? -n : n;
  }
  return raw.toLowerCase();
}

function enhance(table: HTMLTableElement) {
  if (table.hasAttribute(ENHANCED) || table.hasAttribute("data-static")) return;
  const head = table.tHead?.rows[table.tHead.rows.length - 1];
  const body = table.tBodies[0];
  if (!head || !body || body.rows.length < 2) return;
  table.setAttribute(ENHANCED, "");
  let sortCol = -1;
  let dir = 1;
  [...head.cells].forEach((th, col) => {
    th.style.cursor = "pointer";
    th.style.userSelect = "none";
    th.title = th.title || "Sort";
    th.addEventListener("click", () => {
      dir = sortCol === col ? -dir : 1;
      sortCol = col;
      for (const h of head.cells) h.removeAttribute("aria-sort");
      th.setAttribute("aria-sort", dir === 1 ? "ascending" : "descending");
      const rows = [...body.rows];
      // Default to descending for numeric columns (biggest first), ascending for text.
      const firstVal = rows.map((r) => value(r.cells[col])).find((v) => v != null);
      const d = typeof firstVal === "number" ? -dir : dir;
      rows.sort((a, b) => {
        const x = value(a.cells[col]);
        const y = value(b.cells[col]);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en", { numeric: true })) * d;
      });
      for (const r of rows) body.appendChild(r);
    });
  });
  if (body.rows.length >= 6) {
    const bar = document.createElement("div");
    bar.className = "tt-bar flex items-center gap-2 border-b border-stone-100 px-3 py-1.5 text-xs text-stone-500";
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = `Filter ${body.rows.length} rows…`;
    input.className = "w-56 rounded border border-stone-200 bg-white px-2 py-1 text-xs outline-none focus:border-stone-400";
    const count = document.createElement("span");
    bar.append(input, count, Object.assign(document.createElement("span"), { className: "ml-auto hidden sm:inline", textContent: "Click a column to sort" }));
    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      let shown = 0;
      for (const r of body.rows) {
        const hit = !q || (r.textContent ?? "").toLowerCase().includes(q);
        r.style.display = hit ? "" : "none";
        if (hit) shown++;
      }
      count.textContent = q ? `${shown} shown` : "";
    });
    table.parentElement?.insertBefore(bar, table);
  }
}

export function TableTools() {
  const path = usePathname();
  useEffect(() => {
    const run = () => document.querySelectorAll<HTMLTableElement>("main table").forEach(enhance);
    run();
    const obs = new MutationObserver(() => run());
    const main = document.querySelector("main");
    if (main) obs.observe(main, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [path]);
  return null;
}
