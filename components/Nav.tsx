"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Avatar } from "./Avatar";

const GROUPS = [
  {
    id: "review", label: "Market Review", links: [
      { href: "/briefing", label: "Briefing" },
      { href: "/feed", label: "Feed" },
      { href: "/competitors", label: "Competitors" },
      { href: "/products", label: "Products" },
      { href: "/market", label: "Market" },
      { href: "/rates", label: "Rates" },
      { href: "/leverage", label: "Leverage" },
      { href: "/networks", label: "Networks" },
      { href: "/changes", label: "Changes" },
    ],
  },
  { id: "sales", label: "Sales", links: [{ href: "/accounts", label: "In play" }, { href: "/employers", label: "Employers" }] },
  {
    id: "settings", label: "Settings", links: [
      { href: "/settings", label: "Workspace" },
      { href: "/settings/account", label: "Your account" },
      { href: "/sources", label: "Sources" },
      { href: "/alerts", label: "Alerts" },
    ],
  },
];
const ALL = GROUPS.flatMap((g) => g.links);

/** The most specific link matching the current path (so /settings/account doesn't also light up /settings). */
function activeHref(path: string) {
  if (path.startsWith("/signals")) return "/feed";
  return ALL.map((l) => l.href).filter((h) => path === h || path.startsWith(h + "/")).sort((a, b) => b.length - a.length)[0];
}

type Props = { workspaceId: string; workspace: string; workspaceIcon: string | null; workspaces: { id: string; name: string }[]; email: string; userName: string | null; userIcon: string | null; role: string };

export function Nav({ workspaceId, workspace, workspaceIcon, workspaces, email, userName, userIcon, role }: Props) {
  const path = usePathname();
  const router = useRouter();
  const current = activeHref(path);
  const [closed, setClosed] = useState<string[]>([]);
  useEffect(() => { try { setClosed(JSON.parse(localStorage.getItem("nav:closed") ?? "[]")); } catch { /* storage unavailable */ } }, []);
  function toggle(id: string) {
    const next = closed.includes(id) ? closed.filter((x) => x !== id) : [...closed, id];
    setClosed(next);
    try { localStorage.setItem("nav:closed", JSON.stringify(next)); } catch { /* storage unavailable */ }
  }
  async function switchTo(id: string) {
    await api("POST", "/auth/switch", { workspaceId: id });
    router.replace("/briefing");
    router.refresh();
  }
  async function logout() {
    await api("POST", "/auth/logout");
    router.replace("/login");
    router.refresh();
  }
  return (
    <aside className="border-b border-stone-200 bg-white md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:border-b-0 md:border-r">
      <div className="flex items-center gap-2 px-4 py-4">
        <span className="h-2.5 w-2.5 rounded-full bg-accent" />
        <span className="font-mono text-xs font-medium tracking-widest">LOOKOUT</span>
      </div>
      <div className="hidden space-y-1 px-2 pb-3 md:block">
        <Link href="/settings" title="Workspace settings" className={`flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-stone-100 ${current === "/settings" ? "bg-stone-100" : ""}`}>
          <Avatar icon={workspaceIcon} name={workspace} size={22} square />
          <span className="truncate text-sm font-medium">{workspace}</span>
        </Link>
        <Link href="/settings/account" title="Your account" className={`flex items-center gap-2 rounded-md px-2 py-1 hover:bg-stone-100 ${current === "/settings/account" ? "bg-stone-100" : ""}`}>
          <Avatar icon={userIcon} name={userName ?? email} size={18} />
          <span className="truncate text-xs text-stone-500">{email} · {role.toLowerCase()}</span>
        </Link>
        {workspaces.length > 1 && (
          <select
            aria-label="Switch workspace"
            className="ml-1 w-[calc(100%-0.5rem)] truncate rounded bg-transparent text-xs text-stone-500 outline-none hover:bg-stone-100"
            value={workspaceId}
            onChange={(e) => switchTo(e.target.value)}
          >
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.id === workspaceId ? "Switch workspace…" : w.name}</option>)}
          </select>
        )}
      </div>
      {/* Phones: one scrolling row of every page. */}
      <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:hidden">
        {ALL.map((l) => (
          <Link key={l.href} href={l.href} className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${current === l.href ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"}`}>{l.label}</Link>
        ))}
      </nav>
      <nav className="hidden max-h-[calc(100vh-11rem)] flex-col gap-3 overflow-y-auto px-2 pb-14 md:flex">
        {GROUPS.map((g) => {
          const holdsCurrent = g.links.some((l) => l.href === current);
          const open = holdsCurrent || !closed.includes(g.id);
          return (
            <div key={g.id}>
              <button onClick={() => toggle(g.id)} aria-expanded={open} className="flex w-full items-center justify-between px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-stone-400 hover:text-stone-700">
                {g.label}
                <span className={`transition-transform ${open ? "rotate-90" : ""}`}>›</span>
              </button>
              {open && (
                <div className="flex flex-col gap-0.5">
                  {g.links.map((l) => (
                    <Link key={l.href} href={l.href} className={`rounded-md px-3 py-1.5 text-sm ${current === l.href ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"}`}>{l.label}</Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <button onClick={logout} className="hidden px-5 py-4 text-left text-xs text-stone-500 hover:text-stone-900 md:absolute md:bottom-0 md:block">
        Sign out
      </button>
    </aside>
  );
}
