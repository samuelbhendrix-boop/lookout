import type { SignalType } from "@prisma/client";

/**
 * Two-tier classifier.
 *  1. Deterministic keyword rules — free, instant, always available.
 *  2. Optional LLM pass (ANTHROPIC_API_KEY set) — better on ambiguous items.
 * The LLM result wins when present; rules are the fallback and the test baseline.
 */

const RULES: Array<[SignalType, RegExp]> = [
  ["M_AND_A", /\b(acquir|acquisition|merger|merge[sd]?|buyout|divest|takeover)\w*/i],
  ["PRICING", /\b(premiums?|pric(e|es|ing)|rate (increase|filing|hike|cut)s?|discount\w*|undercut\w*|fee schedules?|reimbursement rates?)\b/i],
  ["NETWORK", /\b(network|provider contract|in-network|out-of-network|hospital system|narrow network|contract dispute)\b/i],
  ["REGULATORY", /\b(cms|regulat\w*|lawsuit|settlement|fine[ds]?|doj|ftc|attorney general|compliance|rule|ruling)\b/i],
  ["LEADERSHIP", /\b(ceo|cfo|coo|cto|chief \w+ officer|appoint\w*|resign\w*|steps down|names? .* (president|chief))\b/i],
  ["PARTNERSHIP", /\b(partner\w*|alliance|joint venture|collaborat\w*|teams up)\b/i],
  ["FINANCIAL", /\b(earnings|revenue|guidance|quarter(ly)?|q[1-4] results|profit|loss|eps|medical loss ratio|mlr)\b/i],
  ["PRODUCT", /\b(launch\w*|introduc\w*|new (plan|product|benefit|app|feature)|rolls? out|unveil\w*|expands? (into|to))\b/i],
];

const HIGH_IMPACT = /\b(acquir\w*|merger|lawsuit|exit\w*|withdraw\w*|layoff\w*|ceo|billion|record)\b/i;

export type Classification = { type: SignalType; importance: number };

export function classifyByRules(text: string): Classification {
  let type: SignalType = "OTHER";
  for (const [t, re] of RULES) {
    if (re.test(text)) {
      type = t;
      break;
    }
  }
  let importance = type === "OTHER" ? 1 : 2;
  if (HIGH_IMPACT.test(text)) importance += 2;
  if (type === "M_AND_A" || type === "PRICING") importance += 1;
  return { type, importance: Math.min(5, importance) };
}

const TYPES = new Set<SignalType>([
  "PRICING", "PRODUCT", "NETWORK", "REGULATORY", "LEADERSHIP",
  "M_AND_A", "PARTNERSHIP", "FINANCIAL", "OTHER",
]);

async function classifyByLLM(title: string, summary: string): Promise<Classification | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        model: process.env.CLASSIFIER_MODEL ?? "claude-haiku-5-5",
        max_tokens: 100,
        system:
          "You classify competitive-intelligence news items. Reply with only JSON: " +
          '{"type": one of ' + [...TYPES].join("|") +
          ', "importance": 1-5 where 5 = changes a competitor\'s market position}.',
        messages: [{ role: "user", content: `Title: ${title}\n\nSummary: ${summary.slice(0, 2000)}` }],
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { content?: Array<{ text?: string }> };
    const raw = body.content?.[0]?.text ?? "";
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    if (!TYPES.has(parsed.type)) return null;
    const importance = Math.max(1, Math.min(5, Math.round(Number(parsed.importance) || 2)));
    return { type: parsed.type, importance };
  } catch {
    return null; // never block ingestion on the LLM
  }
}

export async function classify(title: string, summary = ""): Promise<Classification> {
  return (await classifyByLLM(title, summary)) ?? classifyByRules(`${title}\n${summary}`);
}
