import { z } from "zod";
import { parseQuery, route } from "@/lib/api";
import { availableYears, marketShare, rateActions } from "@/lib/marketdata/queries";

const q = z.object({
  state: z.string().regex(/^[A-Z]{2}$/).default("MA"),
  segment: z.enum(["INDIVIDUAL", "SMALL_GROUP", "LARGE_GROUP"]).default("LARGE_GROUP"),
  year: z.coerce.number().int().optional(),
});

/** Market share (fully insured covered lives) by competitor + ACA rate actions for a state. */
export const GET = route("VIEWER", async ({ session, req }) => {
  const { state, segment, year } = parseQuery(req, q);
  const years = await availableYears();
  const y = year ?? years.financialYears[0];
  const [share, actions] = await Promise.all([
    y ? marketShare(session.workspaceId, state, segment, y) : null,
    rateActions(session.workspaceId, state),
  ]);
  return { state, segment, year: y ?? null, years, share, rateActions: actions };
});
