/**
 * Estimated Bedrock prices in USD micros per token, for usage_events.estimated_cost_usd_micros.
 * These are estimates to be checked against https://aws.amazon.com/bedrock/pricing/ before
 * the numbers go into docs/COSTS.md; BEDROCK_PRICING_JSON overrides them without a code change:
 *   {"amazon.nova-2-lite-v1:0": {"inputPerMillionUsd": 0.06, "outputPerMillionUsd": 0.24}}
 */
export interface ModelPrice {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

/**
 * Prompt cache multipliers on the input rate, to verify against the Bedrock pricing page:
 * a cached read is a tenth of an input token, a cache write costs a quarter more than one.
 */
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

const DEFAULTS: Record<string, ModelPrice> = {
  // Nova Lite generation pricing, used for Nova 2 Lite until verified.
  "amazon.nova-lite-v1:0": { inputPerMillionUsd: 0.06, outputPerMillionUsd: 0.24 },
  "amazon.nova-2-lite-v1:0": { inputPerMillionUsd: 0.06, outputPerMillionUsd: 0.24 },
  "amazon.nova-pro-v1:0": { inputPerMillionUsd: 0.8, outputPerMillionUsd: 3.2 },
  "anthropic.claude-sonnet-4-5-20250929-v1:0": { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  // Claude Sonnet 4.6 and 5 list prices on the first-party API; verify the Bedrock rate before publishing numbers.
  "anthropic.claude-sonnet-4-6": { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  "anthropic.claude-sonnet-5": { inputPerMillionUsd: 2, outputPerMillionUsd: 10 },
};

function table(): Record<string, ModelPrice> {
  const raw = process.env.BEDROCK_PRICING_JSON;
  if (!raw) return DEFAULTS;
  try {
    return { ...DEFAULTS, ...(JSON.parse(raw) as Record<string, ModelPrice>) };
  } catch {
    return DEFAULTS;
  }
}

/** Matches cross-region ids too: "us.amazon.nova-2-lite-v1:0" prices like "amazon.nova-2-lite-v1:0". */
export function priceFor(modelId: string): ModelPrice | undefined {
  const t = table();
  if (t[modelId]) return t[modelId];
  const bare = modelId.replace(/^(?:us|eu|apac|global)\./, "");
  return t[bare];
}

/**
 * Integer USD micros; unknown models cost 0 and are flagged by the caller. Cached tokens are
 * counted apart: Bedrock reports them outside inputTokens.
 */
export function estimateCostUsdMicros(modelId: string, inputTokens: number, outputTokens: number, cache: { readTokens?: number; writeTokens?: number } = {}): { micros: number; known: boolean } {
  const p = priceFor(modelId);
  if (!p) return { micros: 0, known: false };
  const cached = (cache.readTokens ?? 0) * CACHE_READ_MULTIPLIER + (cache.writeTokens ?? 0) * CACHE_WRITE_MULTIPLIER;
  const micros = Math.round(inputTokens * p.inputPerMillionUsd + cached * p.inputPerMillionUsd + outputTokens * p.outputPerMillionUsd);
  return { micros, known: true };
}
