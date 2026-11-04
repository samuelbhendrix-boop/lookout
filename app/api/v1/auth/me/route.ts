import { route } from "@/lib/api";

export const GET = route("VIEWER", async ({ session }) => session);
