"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { Avatar } from "./Avatar";
import { Brand } from "./Brand";

type NavLink = { href: string; label: string; children?: Array<{ href: string; label: string }> };
const GROUPS: Array<{ id: string; label: string; links: NavLink[] }> = [
  {
    id: "review", label: "Market review", links: [
      { href: "/updates", label: "Updates" },
      { href: "/competitors", label: "Competitors", children: [{ href: "/competitors", label: "Overview" }, { href: "/competitors/products", label: "Products" }] },
      { href: "/market", label: "Market" },
      { href: "/ai-watch", label: "AI watch" },
    ],
  },
  {
    id: "pricing", label: "Networks & pricing", links: [
      { href: "/leverage", label: "Leverage" },
      { href: "/rates", label: "Prices", children: [{ href: "/rates", label: "Compare hospitals" }, { href: "/rates/explore", label: "Explore a code" }] },
      { href: "/networks", label: "Networks" },
    ],
  },
  { id: "reports", label: "Reports", links: [{ href: "/explore", label: "Data explorer" }, { href: "/reports/launches", label: "Product launches" }, { href: "/reports/filings", label: "State filings (SERFF)" }, { href: "/reports/pack", label: "Monthly pack" }] },
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
const HOME = { href: "/home", label: "Home" };
const ALL = [HOME, ...GROUPS.flatMap((g) => g.links)];

/** The most specific link matching the current path (so /settings/account doesn't also light up /settings). */
function activeHref(path: string) {
  if (path.startsWith("/signals")) return "/updates";
  return ALL.map((l) => l.href).filter((h) => path === h || path.startsWith(h + "/")).sort((a, b) => b.length - a.length)[0];
}

type Props = { workspaceId: string; workspace: string; workspaceIcon: string | null; workspaces: { id: string; name: string }[]; email: string; userName: string | null; userIcon: string | null; role: string; children: React.ReactNode };

/**
 * Two-level navigation: the dark top bar picks a section, the light sidebar lists that section's pages
 * (sub-pages nest under their parent). Home and pages outside any section have no sidebar.
 */
export function Nav({ workspaceId, workspace, workspaceIcon, workspaces, email, userName, userIcon, role, children }: Props) {
  const path = usePathname();
  const router = useRouter();
  const current = activeHref(path);
  const section = GROUPS.find((g) => g.links.some((l) => l.href === current)) ?? null;
  async function switchTo(id: string) {
    await api("POST", "/auth/switch", { workspaceId: id });
    router.replace("/home");
    router.refresh();
  }
  async function logout() {
    await api("POST", "/auth/logout");
    router.replace("/login");
    router.refresh();
  }
  const tab = (on: boolean) => `whitespace-nowrap py-3 text-sm md:py-4 ${on ? "font-semibold text-white shadow-[inset_0_-3px_0_#F2A33A]" : "text-stone-300 hover:text-white"}`;
  const side = (on: boolean, sub = false) => `whitespace-nowrap rounded-md px-3 text-sm ${sub ? "py-1.5 md:ml-3" : "py-2"} ${on ? "bg-white font-semibold text-stone-900 ring-1 ring-stone-200" : "text-stone-600 hover:text-stone-900"}`;
  return (
    <>
      <header className="bg-ink text-white">
        <div className="flex flex-wrap items-center gap-x-7 px-4 md:px-6">
          <Link href="/home" aria-label="Home" className="py-3"><Brand invert /></Link>
          <nav aria-label="Sections" className="order-last flex w-full gap-6 overflow-x-auto md:order-none md:w-auto md:flex-1">
            <Link href={HOME.href} className={tab(current === HOME.href)}>Home</Link>
            {GROUPS.filter((g) => g.id !== "settings").map((g) => (
              <Link key={g.id} href={g.links[0].href} aria-current={section?.id === g.id ? "page" : undefined} className={tab(section?.id === g.id)}>{g.label}</Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-4 text-sm">
            <Link href="/settings" className={section?.id === "settings" ? "font-semibold text-white" : "text-stone-300 hover:text-white"}>Settings</Link>
            {workspaces.length > 1 ? (
              <select aria-label="Switch workspace" className="hidden max-w-40 truncate rounded bg-transparent text-stone-300 outline-none hover:text-white sm:block" value={workspaceId} onChange={(e) => switchTo(e.target.value)}>
                {workspaces.map((w) => <option key={w.id} value={w.id} className="text-stone-900">{w.name}</option>)}
              </select>
            ) : (
              <span className="hidden items-center gap-2 text-stone-300 sm:flex"><Avatar icon={workspaceIcon} name={workspace} size={20} square />{workspace}</span>
            )}
            <Link href="/settings/account" title={`Your account · ${userName || email} · ${role.toLowerCase()}`} aria-label="Your account"><Avatar icon={userIcon} name={userName || email} size={24} /></Link>
            <button onClick={logout} className="text-stone-300 hover:text-white">Sign out</button>
          </div>
        </div>
      </header>
      <div className="flex-1 md:flex">
        {section && (
          <aside className="border-b border-stone-200 bg-stone-50 md:w-52 md:shrink-0 md:border-b-0 md:border-r">
            <div className="md:sticky md:top-0 md:pb-6">
              <div className="hidden px-6 pb-2 pt-6 text-xs font-semibold text-stone-500 md:block">{section.label}</div>
              <nav aria-label={section.label} className="flex gap-1 overflow-x-auto p-2 md:flex-col md:gap-0.5 md:px-3 md:py-0">
                {section.links.map((l) => {
                  const on = current === l.href;
                  // A page with sub-pages lists them underneath while you're on it; the sub-page you're on is the highlighted one.
                  const child = on && l.children ? l.children.filter((c) => path === c.href || path.startsWith(c.href + "/")).sort((x, y) => y.href.length - x.href.length)[0] ?? l.children[0] : null;
                  return on && l.children ? (
                    <div key={l.href} className="flex gap-1 md:flex-col md:gap-0.5">
                      <Link href={l.href} className="whitespace-nowrap px-3 py-2 text-sm font-semibold text-stone-900">{l.label}</Link>
                      {l.children.map((c) => <Link key={c.href} href={c.href} aria-current={child?.href === c.href ? "page" : undefined} className={side(child?.href === c.href, true)}>{c.label}</Link>)}
                    </div>
                  ) : (
                    <Link key={l.href} href={l.href} aria-current={on ? "page" : undefined} className={side(on)}>{l.label}</Link>
                  );
                })}
              </nav>
            </div>
          </aside>
        )}
        {children}
      </div>
    </>
  );
}
