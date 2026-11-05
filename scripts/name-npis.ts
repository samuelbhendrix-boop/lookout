/**
 * Some rate files identify providers by NPI instead of TIN and omit names (Anthem's host-plan files especially).
 * Looks each one up in the public NPPES NPI Registry API and writes data/npi/names.json: npi → [name, state].
 *   npx tsx scripts/name-npis.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { db } from "../lib/db";

const OUT = "data/npi/names.json";
async function main() {
  const known: Record<string, [string, string]> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")).npis : {};
  const rows = await db.$queryRaw<Array<{ tin: string }>>`SELECT DISTINCT tin FROM "ProviderRate" WHERE tin LIKE 'npi:%' AND n > 0`;
  let looked = 0;
  for (const { tin } of rows) {
    const npi = tin.slice(4);
    if (known[npi]) continue;
    const res = await fetch(`https://npiregistry.cms.hhs.gov/api/?version=2.1&number=${npi}`, { signal: AbortSignal.timeout(30_000) });
    const r = (await res.json()) as { results?: Array<{ basic?: { organization_name?: string; first_name?: string; last_name?: string; credential?: string }; addresses?: Array<{ address_purpose: string; state: string }> }> };
    const x = r.results?.[0];
    if (x) {
      const name = x.basic?.organization_name ?? [x.basic?.first_name, x.basic?.last_name, x.basic?.credential].filter(Boolean).join(" ");
      const st = x.addresses?.find((a) => a.address_purpose === "LOCATION")?.state ?? "";
      if (name) known[npi] = [name, st];
    }
    looked++;
    await new Promise((r) => setTimeout(r, 120));
  }
  writeFileSync(OUT, JSON.stringify({ _about: "NPPES NPI Registry (npiregistry.cms.hhs.gov) names and practice-location states for providers that rate files identify only by NPI.", npis: known }));
  console.log(`looked up ${looked}, ${Object.keys(known).length} named`);
  await db.$disconnect();
}
main();
