import data from "@/data/benchmarks/fehb.json";

/**
 * Federal employees, retirees and dependents (FEHB/PSHB) by state: a gap in every other source. CMS loss-ratio filings
 * exclude federal plans and the self-funded counts don't include them, except that BCBSMA reports its federal members
 * to CHIA, so Massachusetts already counts the Blue Cross federal plan (FEP).
 * Estimate: national covered lives spread by the state's share of federal civilian employees (OPM FedScope). Annuitants
 * and postal workers aren't spread exactly like that, so read it as an order of magnitude (about ±30%).
 * About half of federal enrollees choose the Blue Cross federal plan, administered in each state by the local Blue.
 */
export const FEHB = data as typeof data & { employees: Record<string, number>; localBlue: Record<string, string> };

export type FehbEstimate = { state: string; total: number; fep: number; other: number; localBlue: string; inChia: boolean };

export function fehbEstimate(state: string): FehbEstimate | null {
  const emp = FEHB.employees[state];
  if (!emp) return null;
  const share = emp / FEHB.employeesNational;
  const total = Math.round(FEHB.federalCovered * share);
  const fep = Math.min(total, Math.round(FEHB.fep * share));
  return { state, total, fep, other: total - fep, localBlue: FEHB.localBlue[state], inChia: state === "MA" };
}
