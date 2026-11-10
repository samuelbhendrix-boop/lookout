import { redirect } from "next/navigation";

/** Feed, Briefing and Changes are one page now: Updates. Old links keep working. */
export default async function Feed({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = Object.fromEntries(Object.entries(await searchParams).filter(([, v]) => v)) as Record<string, string>;
  redirect(`/updates?${new URLSearchParams(sp)}`);
}
