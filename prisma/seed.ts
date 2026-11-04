/**
 * Demo workspace: login demo@lookout.dev / lookout-demo-123
 * Uses fictional health-plan competitors so the feed has something to show without network access.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { dedupeKey } from "../lib/match";
import { classifyByRules } from "../lib/classify";

const db = new PrismaClient();

async function main() {
  const email = "demo@lookout.dev";
  if (await db.user.findUnique({ where: { email } })) {
    console.log("Seed already applied.");
    return;
  }
  const user = await db.user.create({
    data: { email, name: "Demo Analyst", passwordHash: await bcrypt.hash("lookout-demo-123", 12) },
  });
  const ws = await db.workspace.create({ data: { name: "Demo Strategy Team", slug: "demo" } });
  await db.membership.create({ data: { userId: user.id, workspaceId: ws.id, role: "OWNER" } });

  const [northwind, harbor, keystone] = await Promise.all(
    [
      { name: "Northwind Health", aliases: ["northwind", "nwh"], tier: 1, website: "https://example.com/northwind" },
      { name: "Harbor Mutual", aliases: ["harbor"], tier: 1, website: "https://example.com/harbor" },
      { name: "Keystone Care", aliases: ["keystone"], tier: 2, website: "https://example.com/keystone" },
    ].map((c) => db.competitor.create({ data: { ...c, workspaceId: ws.id } })),
  );

  const items: Array<[string, string, string | null, number]> = [
    ["Northwind Health to acquire regional TPA in $1.2 billion deal", "Expands self-funded administration footprint across New England.", northwind.id, 2],
    ["Harbor Mutual files 9.8% average small-group rate increase", "Filing cites specialty drug trend and hospital unit cost.", harbor.id, 5],
    ["Keystone Care launches virtual-first plan for employers under 100", "Lower premium, PCP required via telehealth vendor.", keystone.id, 8],
    ["Northwind names new chief medical officer", "Former health system CMO joins to lead value-based care.", northwind.id, 12],
    ["Harbor Mutual and major hospital system reach contract agreement after dispute", "Averts out-of-network status for 40k members.", harbor.id, 30],
    ["CMS finalizes rule on prior authorization timelines", "Applies to MA and exchange plans from 2027.", null, 48],
    ["Keystone Q3 earnings: medical loss ratio rises to 88%", "Utilization in outpatient surgery cited.", keystone.id, 72],
  ];
  for (const [title, summary, competitorId, hoursAgo] of items) {
    const { type, importance } = classifyByRules(`${title}\n${summary}`);
    await db.signal.create({
      data: {
        workspaceId: ws.id, competitorId, title, summary, type, importance,
        dedupeKey: dedupeKey(ws.id, null, title),
        publishedAt: new Date(Date.now() - hoursAgo * 3600e3),
        createdAt: new Date(Date.now() - hoursAgo * 3600e3),
      },
    });
  }
  console.log("Seeded demo workspace → demo@lookout.dev / lookout-demo-123");
}

main().finally(() => db.$disconnect());
