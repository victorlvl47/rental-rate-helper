export const OPENAI_PRICING_TABLE_VERSION = 'openai-pricing-2026-09-28';

/** USD per one million tokens. Source: OpenAI API pricing page, reviewed 2026-09-28. */
const PRICE_PER_MILLION: Readonly<Record<string, { input: number; output: number }>> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

export function estimateOpenAiCostUsd(model: string, inputTokens: number | null, outputTokens: number | null): number | null {
  const price = PRICE_PER_MILLION[model];
  if (!price || inputTokens === null || outputTokens === null) return null;
  return Number(((inputTokens * price.input + outputTokens * price.output) / 1_000_000).toFixed(6));
}
