import { getSession, hasRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { AlertForm } from "@/components/forms";
import { ActionButton } from "@/components/ActionButton";
import { Empty, timeAgo } from "@/components/ui";

export default async function AlertsPage() {
  const session = (await getSession())!;
  const [rules, competitors] = await Promise.all([
    db.alertRule.findMany({ where: { workspaceId: session.workspaceId }, orderBy: { createdAt: "desc" } }),
    db.competitor.findMany({ where: { workspaceId: session.workspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const nameOf = Object.fromEntries(competitors.map((c) => [c.id, c.name]));
  const isAdmin = hasRole(session.role, "ADMIN");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="h1">Alerts</h1>
        <p className="text-sm text-stone-500">
          Instant rules fire per new story; digest rules send a weekly roll-up. All set conditions must match. Delivered to a Slack-compatible webhook, with retries.
        </p>
      </div>
      {isAdmin && <AlertForm competitors={competitors} />}
      {rules.length === 0 ? (
        <Empty title="No alert rules">Start narrow — e.g. importance ≥4 on tier-1 competitors. Noisy alerts get muted.</Empty>
      ) : (
        <ul className="card divide-y divide-stone-100">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {r.name}{" "}
                  <span className="ml-1 rounded bg-stone-100 px-1.5 font-mono text-[11px] text-stone-600">{r.mode === "INSTANT" ? "instant" : "weekly digest"}</span>{" "}
                  {!r.enabled && <span className="ml-1 rounded bg-stone-100 px-1.5 text-xs text-stone-500">paused</span>}
                </p>
                <p className="text-xs text-stone-500">
                  {[
                    r.competitorIds.length ? r.competitorIds.map((id) => nameOf[id] ?? "?").join(", ") : "any competitor",
                    r.types.length ? r.types.map((t) => (t === "M_AND_A" ? "M&A" : t.toLowerCase())).join("/") : "any type",
                    `importance ≥${r.minImportance}`,
                    r.keywords.length ? `keywords: ${r.keywords.join(", ")}` : null,
                  ].filter(Boolean).join(" · ")}
                </p>
              </div>
              <p className="font-mono text-xs text-stone-500">{r.lastFiredAt ? `fired ${timeAgo(r.lastFiredAt)} ago` : "never fired"}</p>
              {isAdmin && (
                <div className="flex gap-3">
                  <ActionButton method="PATCH" path={`/alerts/${r.id}`} body={{ enabled: !r.enabled }}>{r.enabled ? "Pause" : "Resume"}</ActionButton>
                  <ActionButton method="DELETE" path={`/alerts/${r.id}`} confirmText="Delete rule?" className="text-xs text-red-600 hover:underline">Delete</ActionButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
