import { db } from "@/lib/db";
import { getSession, hasRole } from "@/lib/auth";
import { PACK_NAME, packFilename } from "@/lib/pack";
import { PackLink } from "@/components/PackLink";

export const dynamic = "force-dynamic";
export const metadata = { title: "Monthly pack" };

const TABS: Array<[string, string]> = [
  ["Brief", "The month's main changes in sentences"],
  ["Carrier overview", "Every carrier's latest members, premium, loss ratio, employer accounts and filed plans"],
  ["Members and price by year", "Share and growth, premium and loss ratio by year, large group included"],
  ["Filed plans", "Individual and small group plans, premiums and rate changes by plan year"],
  ["Employer accounts", "Large group employer accounts and premium per person, from Form 5500"],
  ["Marketed products", "What each carrier sells now, including large group, from their websites"],
  ["State filings", "Loaded SERFF filings with takeaways"],
  ["AI watch", "AI news that matters to insurers, last 35 days"],
  ["Changes this month", "Accounts won and lost, rate and network changes, last 35 days"],
];
const day = (d: Date | null | undefined) => (d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null);

export default async function PackPage() {
  const session = (await getSession())!;
  const link = await db.packLink.findUnique({ where: { workspaceId: session.workspaceId }, select: { createdAt: true, lastUsedAt: true } });
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="h1">Monthly pack</h1>
        <p className="text-sm text-stone-500">Payersight&apos;s headline tables in one Excel workbook, for an assistant such as Microsoft 365 Copilot that can&apos;t sign in here. It is built when you download it, so it is always current.</p>
      </div>
      <section className="card space-y-3 p-5">
        <h2 className="font-semibold">Download</h2>
        <p className="text-sm text-stone-600">Save it to the same OneDrive or SharePoint folder each month. Each download is named with the day you pulled it, so today&apos;s is “{packFilename()}” and the copies sort in date order.</p>
        <a href="/api/pack" className="btn inline-block">Download this month&apos;s pack</a>
      </section>
      <section className="card space-y-3 p-5">
        <h2 className="font-semibold">Private link, for an automatic monthly pull</h2>
        <p className="text-sm text-stone-600">A scheduled flow can fetch the workbook from this link without signing in. Treat the link like a password: anyone who has it can download the pack. It is read-only and serves this one file.</p>
        <PackLink exists={!!link} createdAt={day(link?.createdAt)} lastUsedAt={day(link?.lastUsedAt)} canManage={hasRole(session.role, "ADMIN")} />
      </section>
      <section className="card space-y-3 p-5">
        <h2 className="font-semibold">What&apos;s inside</h2>
        <table data-static className="w-full text-sm">
          <tbody className="divide-y divide-stone-100">
            <tr><td className="w-56 py-1.5 pr-4 font-medium">Read me</td><td className="py-1.5 text-stone-600">What each tab holds and where its numbers come from</td></tr>
            {TABS.map(([t, d]) => <tr key={t}><td className="w-56 py-1.5 pr-4 font-medium">{t}</td><td className="py-1.5 text-stone-600">{d}</td></tr>)}
          </tbody>
        </table>
      </section>
      <section className="card space-y-2 p-5">
        <h2 className="font-semibold">A prompt to save in Copilot</h2>
        <p className="rounded bg-stone-50 p-3 text-sm text-stone-700">Using the most recent file whose name starts with “{PACK_NAME}”, summarise what changed for our competitors this month. Start with the Brief tab, then use Changes this month and Carrier overview for the numbers. Say which tab each figure comes from.</p>
      </section>
    </div>
  );
}
