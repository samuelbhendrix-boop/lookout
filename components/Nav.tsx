"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/client";

const LINKS = [
  { href: "/feed", label: "Feed" },
  { href: "/competitors", label: "Competitors" },
  { href: "/market", label: "Market" },
  { href: "/employers", label: "Employers" },
  { href: "/rates", label: "Rates" },
  { href: "/sources", label: "Sources" },
  { href: "/alerts", label: "Alerts" },
  { href: "/settings", label: "Settings" },
];

type Props = { workspaceId: string; workspace: string; workspaces: { id: string; name: string }[]; email: string; role: string };

export function Nav({ workspaceId, workspace, workspaces, email, role }: Props) {
  const path = usePathname();
  const router = useRouter();
  async function switchTo(id: string) {
    await api("POST", "/auth/switch", { workspaceId: id });
    router.replace("/feed");
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
      <div className="hidden px-4 pb-4 md:block">
        {workspaces.length > 1 ? (
          <select
            aria-label="Switch workspace"
            className="-ml-1 w-full truncate rounded bg-transparent text-sm font-medium outline-none hover:bg-stone-100"
            value={workspaceId}
            onChange={(e) => switchTo(e.target.value)}
          >
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        ) : (
          <p className="truncate text-sm font-medium">{workspace}</p>
        )}
        <p className="truncate text-xs text-stone-500">{email} · {role.toLowerCase()}</p>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-0">
        {LINKS.map((l) => {
          const active = path === l.href || path.startsWith(l.href + "/") || (l.href === "/feed" && path.startsWith("/signals"));
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${active ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"}`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
      <button onClick={logout} className="hidden px-5 py-4 text-left text-xs text-stone-500 hover:text-stone-900 md:absolute md:bottom-0 md:block">
        Sign out
      </button>
    </aside>
  );
}
