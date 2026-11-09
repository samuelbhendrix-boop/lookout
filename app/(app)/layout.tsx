import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const workspaces = await db.membership.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "asc" },
    select: { workspace: { select: { id: true, name: true } } },
  });
  return (
    <div className="min-h-screen md:flex">
      <Nav
        workspaceId={session.workspaceId}
        workspace={session.workspaceName}
        workspaceIcon={session.workspaceIcon}
        workspaces={workspaces.map((w) => w.workspace)}
        email={session.email}
        userName={session.name}
        userIcon={session.userIcon}
        role={session.role}
      />
      <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
