import { db } from "@/lib/db";
import { HttpError, parseBody, route } from "@/lib/api";
import { memberInvite } from "@/lib/validators";

export const GET = route("VIEWER", async ({ session }) =>
  db.membership.findMany({
    where: { workspaceId: session.workspaceId },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, email: true, name: true } } },
  }),
);

/**
 * MVP: adds an existing user by email. Next step is email invites with a signed token
 * (InviteToken table + transactional email) so people can be invited before signing up.
 */
export const POST = route("ADMIN", async ({ session, req }) => {
  const { email, role } = await parseBody(req, memberInvite);
  const user = await db.user.findUnique({ where: { email } });
  if (!user) throw new HttpError(404, "No account with that email yet — ask them to sign up first");
  return db.membership.create({ data: { userId: user.id, workspaceId: session.workspaceId, role } });
});
