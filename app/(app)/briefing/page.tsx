import { redirect } from "next/navigation";

export default async function Briefing({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  redirect(`/updates?days=${sp.days === "30" ? 30 : 7}`);
}
