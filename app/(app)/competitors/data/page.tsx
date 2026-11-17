import { redirect } from "next/navigation";

/** The data table moved to its own page (Data explorer); old links and saved pulls keep working. */
export default async function DataRedirect({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = new URLSearchParams(Object.entries(await searchParams).filter(([, v]) => v) as Array<[string, string]>);
  redirect(`/explore${q.size ? `?${q}` : ""}`);
}
