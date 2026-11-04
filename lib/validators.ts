import { z } from "zod";

export const SIGNAL_TYPES = [
  "PRICING",
  "PRODUCT",
  "NETWORK",
  "REGULATORY",
  "LEADERSHIP",
  "M_AND_A",
  "PARTNERSHIP",
  "FINANCIAL",
  "OTHER",
] as const;
export const SIGNAL_STATUSES = ["NEW", "REVIEWED", "ESCALATED", "ARCHIVED"] as const;
export const ROLES = ["OWNER", "ADMIN", "ANALYST", "VIEWER"] as const;

const aliasList = z
  .array(z.string().trim().min(1).max(80))
  .max(20)
  .transform((a) => [...new Set(a.map((s) => s.toLowerCase()))]);

export const signupSchema = z
  .object({
    email: z.string().email().toLowerCase(),
    password: z.string().min(10, "Use at least 10 characters").max(200),
    name: z.string().trim().max(100).optional(),
    workspaceName: z.string().trim().min(2).max(80).optional(),
    inviteToken: z.string().min(10).max(100).optional(), // join an existing workspace instead
  })
  .refine((b) => b.workspaceName || b.inviteToken, { message: "Required", path: ["workspaceName"] });

export const inviteCreate = z.object({
  role: z.enum(["ADMIN", "ANALYST", "VIEWER"]).default("ANALYST"),
  days: z.coerce.number().int().min(1).max(30).default(7),
  maxUses: z.coerce.number().int().min(1).max(500).default(25),
});
export const inviteAccept = z.object({ token: z.string().min(10).max(100) });
export const workspaceSwitch = z.object({ workspaceId: z.string().cuid() });

export const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

export const competitorCreate = z.object({
  name: z.string().trim().min(1).max(120),
  website: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  aliases: aliasList.default([]),
  tier: z.coerce.number().int().min(1).max(3).default(2),
  notes: z.string().max(5000).optional(),
});
export const competitorUpdate = competitorCreate.partial();

export const sourceCreate = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["RSS", "MANUAL"]).default("RSS"),
  url: z.string().url().optional(),
  competitorId: z.string().cuid().nullable().optional(),
  pollMinutes: z.coerce.number().int().min(15).max(10080).default(60),
  enabled: z.boolean().default(true),
}).refine((s) => s.kind !== "RSS" || !!s.url, { message: "RSS sources need a URL", path: ["url"] });
export const sourceUpdate = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  url: z.string().url().optional(),
  competitorId: z.string().cuid().nullable().optional(),
  pollMinutes: z.coerce.number().int().min(15).max(10080).optional(),
  enabled: z.boolean().optional(),
});

export const signalCreate = z.object({
  title: z.string().trim().min(1).max(500),
  url: z.string().url().optional(),
  summary: z.string().max(10000).optional(),
  competitorId: z.string().cuid().nullable().optional(),
  type: z.enum(SIGNAL_TYPES).optional(), // omitted → classifier decides
  importance: z.coerce.number().int().min(1).max(5).optional(),
  publishedAt: z.coerce.date().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
});

export const signalUpdate = z.object({
  status: z.enum(SIGNAL_STATUSES).optional(),
  type: z.enum(SIGNAL_TYPES).optional(),
  importance: z.coerce.number().int().min(1).max(5).optional(),
  competitorId: z.string().cuid().nullable().optional(),
  summary: z.string().max(10000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  duplicateOfId: z.null().optional(), // only "detach from story" is allowed via API
});

export const signalQuery = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(SIGNAL_STATUSES).optional(),
  type: z.enum(SIGNAL_TYPES).optional(),
  competitorId: z.string().cuid().optional(),
  minImportance: z.coerce.number().int().min(1).max(5).optional(),
  tag: z.string().max(40).optional(),
  cursor: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const commentCreate = z.object({ body: z.string().trim().min(1).max(5000) });

export const alertRuleCreate = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  mode: z.enum(["INSTANT", "DIGEST_WEEKLY"]).default("INSTANT"),
  competitorIds: z.array(z.string().cuid()).max(50).default([]),
  types: z.array(z.enum(SIGNAL_TYPES)).default([]),
  keywords: aliasList.default([]),
  minImportance: z.coerce.number().int().min(1).max(5).default(3),
  webhookUrl: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://") || process.env.ALLOW_HTTP_WEBHOOKS === "true", "Webhook must be HTTPS"),
});
export const alertRuleUpdate = alertRuleCreate.partial();

export const memberInvite = z.object({
  email: z.string().email().toLowerCase(),
  role: z.enum(["ADMIN", "ANALYST", "VIEWER"]).default("ANALYST"),
});
