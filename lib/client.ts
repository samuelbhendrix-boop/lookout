"use client";

/** Thin fetch wrapper for client components. Throws Error(message) on the API's error envelope. */
export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = json?.error?.details?.fieldErrors as Record<string, string[]> | undefined;
    const first = details && Object.entries(details).find(([, v]) => v?.length);
    throw new Error(first ? `${first[0]}: ${first[1][0]}` : json?.error?.message ?? `Request failed (${res.status})`);
  }
  return json.data as T;
}

/** "a, b ,c" → ["a","b","c"] */
export const splitList = (s: string) =>
  s.split(",").map((x) => x.trim()).filter(Boolean);
