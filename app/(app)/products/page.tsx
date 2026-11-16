import { redirect } from "next/navigation";

/** Products moved under Competitors; old links and bookmarks keep working. */
export default async function ProductsRedirect({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = new URLSearchParams(Object.entries(await searchParams).filter(([, v]) => v) as Array<[string, string]>);
  redirect(`/competitors/products${q.size ? `?${q}` : ""}`);
}
