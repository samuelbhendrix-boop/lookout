import { route } from "@/lib/api";
import { workspaceStats } from "@/lib/queries";

export const GET = route("VIEWER", async ({ session }) => workspaceStats(session.workspaceId));
