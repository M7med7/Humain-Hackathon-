/**
 * List prices in USD per million tokens. Token counts are the primary measurement;
 * cost is derived from them so results stay comparable if prices change.
 * Thinking tokens are billed as output. Cached input is billed at 10% of input.
 * Source: published Gemini API rates collected 30 Oct 2026; re-check before quoting.
 */
interface ModelPrice {
  input: number;
  output: number;
}

const PRICES: Record<string, ModelPrice> = {
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  'gemini-3.6-flash': { input: 1.5, output: 7.5 },
};

const CACHED_INPUT_SHARE = 0.1;
const PER_MILLION = 1_000_000;

export interface TokenUsage {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  thinkingTokens: number;
}

/** Cost of one call in USD; unknown models count as zero and are flagged in reports. */
export function costUsd(model: string, usage: TokenUsage): number {
  const price = PRICES[model];
  if (!price) return 0;
  const freshInput = Math.max(0, usage.inputTokens - usage.cachedTokens);
  const input = freshInput * price.input + usage.cachedTokens * price.input * CACHED_INPUT_SHARE;
  const output = (usage.outputTokens + usage.thinkingTokens) * price.output;
  return (input + output) / PER_MILLION;
}

export function hasPrice(model: string): boolean {
  return model in PRICES;
}
