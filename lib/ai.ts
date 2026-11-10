/**
 * One place for the app's short AI write-ups (Anthropic Messages API). Extended thinking is turned off: these are
 * one-paragraph summaries, and a model that thinks first can spend the whole token budget before writing anything.
 * If the API rejects the thinking setting, the call is retried once without it and with more room.
 */
export async function claudeText(opts: { system: string; user: string; maxTokens?: number; label: string; model?: string; timeoutMs?: number }): Promise<{ text: string; model: string } | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  let model = opts.model ?? process.env.CLASSIFIER_MODEL ?? "claude-haiku-5-5";
  const call = async (thinkingOff: boolean) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
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
    // A model this account can't use: fall back to the default one.
    if (opts.model && (res.status === 404 || (res.status === 400 && /model/i.test(raw)))) { console.error(`[ai] ${opts.label}: ${model} refused (HTTP ${res.status} ${raw.slice(0, 300)}); falling back`); model = process.env.CLASSIFIER_MODEL ?? "claude-haiku-5-5"; ({ res, raw } = await call(true)); }
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

/**
 * Structured output: the model must answer by "calling" a tool whose input is the given JSON schema, so the reply is
 * always well-formed JSON (no stray quotes or prose). Returns the tool input, or null on failure.
 */
const thinkingOff = new Map<string, Record<string, unknown>>();
const noForce = new Set<string>(); // models that refuse a forced tool_choice
export async function claudeJson(opts: { system: string; user: string; schema: Record<string, unknown>; tool: string; maxTokens?: number; label: string; model?: string; timeoutMs?: number }): Promise<{ data: unknown; model: string } | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  let model = opts.model ?? process.env.CLASSIFIER_MODEL ?? "claude-haiku-5-5";
  // Thinking off and the tool forced; if the API objects to that combination, retry letting the model choose the tool.
  // How to switch thinking off differs by model: older ones take {type:"disabled"}, newer ones ask for
  // {type:"between_tools"}. Start with "disabled"; if the API names another type, use that from then on.
  let off: Record<string, unknown> = thinkingOff.get(model) ?? { type: "disabled" };
  const call = (forced = true) => fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model, max_tokens: opts.maxTokens ?? 4000, system: forced ? opts.system : `${opts.system}\n\nAnswer only by calling the ${opts.tool} tool.`, messages: [{ role: "user", content: opts.user }],
      tools: [{ name: opts.tool, description: "Record the result.", input_schema: opts.schema }],
      ...(forced ? { tool_choice: { type: "tool", name: opts.tool }, thinking: off } : { tool_choice: { type: "auto" } }),
    }),
  });
  try {
    let res = await call(!noForce.has(model));
    let raw = await res.text();
    const named = res.status === 400 ? /send \\?"thinking\\?":\s*\{\s*\\?"type\\?":\s*\\?"([a-z_]+)\\?"/.exec(raw)?.[1] : undefined;
    if (named && named !== off.type) { off = { type: named }; thinkingOff.set(model, off); res = await call(); raw = await res.text(); }
    if (res.status === 400 && /thinking|tool_choice/i.test(raw)) {
      if (/tool_choice/i.test(raw)) noForce.add(model); console.error(`[ai] ${opts.label}: ${raw.slice(0, 200)}; retrying without forcing the tool`); res = await call(false); raw = await res.text(); }
    if (opts.model && (res.status === 404 || (res.status === 400 && /model/i.test(raw)))) { console.error(`[ai] ${opts.label}: ${model} refused (HTTP ${res.status} ${raw.slice(0, 300)}); falling back`); model = process.env.CLASSIFIER_MODEL ?? "claude-haiku-5-5"; res = await call(); raw = await res.text(); }
    if (!res.ok) { console.error(`[ai] ${opts.label}: HTTP ${res.status} ${raw.slice(0, 300)}`); return null; }
    const body = JSON.parse(raw) as { content?: Array<{ type?: string; input?: unknown }>; stop_reason?: string };
    const block = (body.content ?? []).find((b) => b.type === "tool_use");
    if (!block) { console.error(`[ai] ${opts.label}: no structured reply (stop: ${body.stop_reason})`); return null; }
    if (body.stop_reason === "max_tokens") console.error(`[ai] ${opts.label}: reply hit the token limit; it may be incomplete`);
    return { data: block.input, model };
  } catch (e) {
    console.error(`[ai] ${opts.label} failed: ${(e as Error).message}`);
    return null;
  }
}
