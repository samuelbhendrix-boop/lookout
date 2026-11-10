/**
 * The analyst read on top of the product-launch report. Written by hand from the report's numbers and the sources
 * below; dated, because the numbers under it refresh as new filings arrive and this text doesn't.
 */
export const LAUNCHES_READ_DATE = "November 9, 2026";

const SOURCES = [
  { label: "KFF — Tracking insurer participation changes in the ACA Marketplaces in 2027", url: "https://www.kff.org/private-insurance/issue-brief/tracking-insurer-participation-changes-in-the-aca-marketplaces-in-2027/" },
  { label: "Becker's — How insurers' ACA footprints are changing in 2027", url: "https://www.beckerspayer.com/payer/aca/how-insurers-aca-footprints-are-changing-in-2027/" },
  { label: "Becker's — 5 payers entering ACA markets in 2027", url: "https://www.beckerspayer.com/payer/aca/5-payers-entering-aca-markets-in-2027/" },
  { label: "Healthcare Dive — Centene, Oscar, UnitedHealthcare add counties for 2027", url: "https://www.healthcaredive.com/news/centene-oscar-unitedhealthcare-new-counties-aca-2027/833442/" },
  { label: "Becker's — Centene to launch CHOICE options in 4 more states", url: "https://www.beckerspayer.com/?p=29451" },
  { label: "Antidote Health expands into Texas and Georgia (InsuranceNewsNet)", url: "https://insurancenewsnet.com/oarticle/antidote-health-expands-into-texas-and-georgia-bringing-affordable-coverage-and-0-virtual-care-to-new-aca-shoppers" },
  { label: "Oscar Health — first-half 2026 results (Business Wire)", url: "https://www.businesswire.com/news/home/20260806425955/en/Oscar-Health-Announces-Record-Financial-Results-for-First-Half-2026-and-Raises-Full-Year-2026-Outlook" },
  { label: "NHPR — Ambetter to exit New Hampshire's ACA marketplace", url: "https://www.nhpr.org/health/2026-06-29/ambetter-health-exit-new-hampshire-aca-marketplace" },
  { label: "Becker's — Baylor Scott & White Health Plan to exit Medicaid, individual markets", url: "https://www.beckershospitalreview.com/finance/baylor-scott-white-health-plan-to-exit-medicaid-individual-markets-cut-321-jobs/" },
  { label: "Becker's — Aetna to exit individual market", url: "https://www.beckerspayer.com/payer/aetna-to-exit-individual-market/" },
];

export function LaunchesRead() {
  return (
    <section className="card space-y-3 p-5 text-sm leading-relaxed">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight">The read</h2>
        <span className="font-mono text-[10px] uppercase tracking-wide text-stone-500">Written {LAUNCHES_READ_DATE} · numbers below refresh with each filing year</span>
      </div>

      <p><span className="font-semibold">1. Fewer launches, more exits.</span> New products fell from 163 in the 2025 filings to 135 for 2026 and 98 for 2027. Exits now outnumber entries about four to one (61 exits vs 21 entries by carrier, state and market for 2026; 68 vs 13 for 2027). The enhanced premium tax credits expired at the end of 2025 and sign-ups fell by more than a million (KFF). Aetna left the individual market for 2026 (about 1 million members). Cigna (about 369,000), Baylor Scott &amp; White (about 100,000 today; 240,770 at filing) and Ambetter in New Hampshire and Delaware leave for 2027.</p>

      <p><span className="font-semibold">2. One in five &quot;new&quot; products isn&apos;t new.</span> 56 of the 298 launches filed for 2025–2026 moved existing members into a new product or legal entity. Examples: Centene&apos;s Florida Ambetter (1.18 million) and Oscar&apos;s Florida HMOs (1.2 million). They&apos;re flagged and kept out of the success rankings below.</p>

      <p><span className="font-semibold">3. What actually won: cheap HMOs from national carriers in big, growing Southern markets.</span></p>
      <ul className="ml-5 list-disc space-y-0.5">
        <li><span className="font-medium">Oscar&apos;s Texas Guided Care HMO (2025):</span> zero to 138,592 members by the 2027 filing, priced right at the market median. Oscar&apos;s total membership grew 46% to 2.96 million by mid-2026.</li>
        <li><span className="font-medium">Elevance&apos;s Wellpoint-branded HMO and POS in Texas:</span> 78,631 and 37,566 members (the HMO priced 6% under the market median), plus another 22,534 in Florida. This is Elevance taking its Medicaid brand into the exchange at Medicaid-like network costs.</li>
        <li><span className="font-medium">Oscar in Mississippi (2026):</span> 15% of the state&apos;s market in its first year.</li>
        <li><span className="font-medium">Blue Cross Blue Shield of Alabama:</span> a single statewide silver EPO plan reached 16,440 members.</li>
      </ul>
      <p>The pattern: a narrow network, a price at or under the median, and states where subsidized demand concentrated.</p>

      <p><span className="font-semibold">4. Most launches go nowhere, and feature-led ones almost never scale.</span> Of 242 genuinely new launches with an enrollment count so far, 5% reached 5,000 members and the median reached 3. Bundled adult dental and vision is the most common add-on, yet the median launch reached 18 members and 2% reached 5,000. HSA, health-system co-branded and provider-owned launches have medians between 0 and 8 members. Treat them as retention and upsell variants, not growth engines. The exception is rewards and virtual-care packaging, and only when it rides on an already cheap HMO (Wellpoint).</p>

      <p><span className="font-semibold">5. 2027 shifts from networks to plan design and the primary-care front door.</span> Condition-specific plans first appeared as variants inside bigger products (Oscar&apos;s Texas HMO carried some). For 2027 they become products in their own right across several carriers. That&apos;s unproven until the 2028 filings show enrollment.</p>
      <ul className="ml-5 list-disc space-y-0.5">
        <li><span className="font-medium">Condition-specific plans:</span>
          <ul className="ml-5 list-[circle] space-y-0.5">
            <li>Oscar: &quot;Simple Diabetes&quot; and &quot;Breathe Easy&quot; COPD plans in South Carolina and Oklahoma</li>
            <li>Ambetter: congestive heart failure, diabetes and asthma plans</li>
            <li>Antidote: diabetes and hypertension plans</li>
          </ul>
        </li>
        <li><span className="font-medium">$0 or near-$0 primary care through partners:</span>
          <ul className="ml-5 list-[circle] space-y-0.5">
            <li>Ambetter with Marathon Health in Indiana and Missouri</li>
            <li>CommunityCare&apos;s direct-primary-care plans in Oklahoma</li>
            <li>Florida Blue&apos;s myBlue Essentials ($5 primary-care visits and $5 labs)</li>
            <li>UnitedHealthcare with Sanitas in Arizona</li>
          </ul>
        </li>
        <li><span className="font-medium">Virtual-first:</span> Antidote&apos;s unlimited $0 virtual primary care, new in Texas and Georgia.</li>
        <li><span className="font-medium">Medicaid plans entering the exchange for continuity when people churn between the two:</span> AmeriHealth Caritas Next in Indiana and Ohio, CalOptima and Colorado Access.</li>
        <li><span className="font-medium">Health-system-owned entrants:</span> Peak Health in West Virginia and Aspirus in Minnesota.</li>
        <li><span className="font-medium">ICHRA, now called &quot;CHOICE&quot;:</span> Centene sells it in 13 states and adds four more for 2027, aimed at employers with 100–1,000 lives. Antidote sells it too.</li>
      </ul>

      <p><span className="font-semibold">6. New England.</span></p>
      <ul className="ml-5 list-disc space-y-0.5">
        <li><span className="font-medium">Ambetter&apos;s New Hampshire exit:</span> about 11,600 members and roughly 20% of the state&apos;s marketplace (NHPR), with 25,683 at filing. That&apos;s the region&apos;s clearest share opening for 2027.</li>
        <li><span className="font-medium">New filings for 2027:</span>
          <ul className="ml-5 list-[circle] space-y-0.5">
            <li>Point32Health: a national-network &quot;National Access&quot; EPO in New Hampshire small group and Maine</li>
            <li>Health New England: &quot;Wise Saver&quot; HSA plans in Massachusetts</li>
            <li>BCBS of Rhode Island: a narrower BlueCHiP Select small-group line</li>
            <li>Anthem Connecticut: new Pathway EPOs priced about 13–15% under the market</li>
          </ul>
        </li>
        <li><span className="font-medium">What&apos;s missing:</span> nobody in New England filed the condition-specific or $0-primary-care designs that national carriers are testing.</li>
      </ul>

      <p><span className="font-semibold">My take:</span> the only proven playbook in this data is price. A narrow HMO at or under the median, in a market with demand, wins; feature bundles don&apos;t move enrollment. The 2027 design experiments are the ones to watch. If condition-specific plans pull members, they let a carrier attract (and price for) chronic members it can actually manage. The 2028 filings will tell. For a New England carrier, the near-term moves are New Hampshire&apos;s orphaned Ambetter members and CHOICE/ICHRA for 100–1,000-life employers. National carriers are building those channels now.</p>

      <details className="text-xs text-stone-500">
        <summary className="cursor-pointer">Sources</summary>
        <ul className="mt-1 list-disc pl-5">{SOURCES.map((s) => <li key={s.url}><a className="underline" href={s.url} target="_blank" rel="noopener noreferrer">{s.label}</a></li>)}</ul>
      </details>
    </section>
  );
}
