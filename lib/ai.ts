/**
 * One place for the app's short AI write-ups (Anthropic Messages API). Extended thinking is turned off: these are
 * one-paragraph summaries, and a model that thinks first can spend the whole token budget before writing anything.
 * If the API rejects the thinking setting, the call is retried once without it and with more room.
 */
export async function claudeText(opts: { system: string; user: string; maxTokens?: number; label: string }): Promise<{ text: string; model: string } | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = process.env.CLASSIFIER_MODEL ?? "claude-haiku-5-5";
  const call = async (thinkingOff: boolean) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: AbortSignal.timeout(60_000),
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model, max_tokens: thinkingOff ? (opts.maxTokens ?? 1200) : 8000, system: opts.system,
        messages: [{ role: "user", content: opts.user }],
        ...(thinkingOff ? { thinking: { type: "disabled" } } : {}),
      }),
    });
    const raw = await res.text();
    return { res, raw };
  };
  try {
    let { res, raw } = await call(true);
    if (res.status === 400 && /thinking/i.test(raw)) ({ res, raw } = await call(false));
    if (!res.ok) { console.error(`[ai] ${opts.label}: HTTP ${res.status} ${raw.slice(0, 300)}`); return null; }
    const body = JSON.parse(raw) as { content?: Array<{ type?: string; text?: string }>; stop_reason?: string };
    const text = (body.content ?? []).filter((b) => b.type === "text" && b.text).map((b) => b.text!.trim()).join("\n\n").trim();
    if (!text) { console.error(`[ai] ${opts.label}: empty reply (stop: ${body.stop_reason}; blocks: ${(body.content ?? []).map((b) => b.type).join(",")})`); return null; }
    return { text, model };
  } catch (e) {
    console.error(`[ai] ${opts.label} failed: ${(e as Error).message}`);
    return null;
  }
}
