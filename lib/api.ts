import { NextResponse } from "next/server";
import { ZodError, type z, type ZodTypeAny } from "zod";
import { Prisma, type Role } from "@prisma/client";
import { getSession, hasRole, type SessionContext } from "./auth";
import { assertPublicUrl, BlockedUrlError } from "./net";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Ctx<P> = { session: SessionContext; params: P; req: Request };

/**
 * Wraps a route handler with: auth, role check, consistent error envelope.
 * Every API response is either { data } or { error: { message, details? } }.
 */
export function route<P = Record<string, string>>(
  minRole: Role,
  handler: (ctx: Ctx<P>) => Promise<unknown>,
) {
  return async (req: Request, ctx: { params: Promise<P> }) => {
    try {
      const session = await getSession();
      if (!session) throw new HttpError(401, "Not authenticated");
      if (!hasRole(session.role, minRole)) throw new HttpError(403, "Insufficient role");
      const params = (await ctx?.params) ?? ({} as P);
      const result = await handler({ session, params, req });
      if (result instanceof Response) return result;
      return NextResponse.json({ data: result ?? null });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError)
    return NextResponse.json({ error: { message: err.message } }, { status: err.status });
  if (err instanceof ZodError)
    return NextResponse.json(
      { error: { message: "Validation failed", details: err.flatten() } },
      { status: 422 },
    );
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002")
      return NextResponse.json({ error: { message: "Already exists" } }, { status: 409 });
    if (err.code === "P2025")
      return NextResponse.json({ error: { message: "Not found" } }, { status: 404 });
  }
  console.error(err);
  return NextResponse.json({ error: { message: "Internal error" } }, { status: 500 });
}

export async function parseBody<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.output<S>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  return schema.parse(json);
}

export function parseQuery<S extends ZodTypeAny>(req: Request, schema: S): z.output<S> {
  const url = new URL(req.url);
  return schema.parse(Object.fromEntries(url.searchParams));
}

/** Rejects user-supplied outbound URLs that resolve to private/internal addresses (422). */
export async function checkUrl(url: string | undefined) {
  if (!url) return;
  try {
    await assertPublicUrl(url);
  } catch (e) {
    throw new HttpError(422, e instanceof BlockedUrlError ? `URL not allowed: ${e.message}` : "URL could not be resolved");
  }
}
