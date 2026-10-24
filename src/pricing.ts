import type { ProviderName } from './agent/model.js';
import type { TokenUsage } from './agent/reviewer.js';
import { readAsset } from './assets.js';

export const PRICING_ASSET = 'config/pricing.json';

interface Rates {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens (thinking included). */
  output: number;
}

interface PricePeriod extends Rates {
  /** Last day (inclusive, UTC, YYYY-MM-DD) this price applies; omit for the current price. */
  until?: string;
  longContext?: Rates;
}

interface ModelPricing {
  longContextThreshold?: number;
  periods: PricePeriod[];
}

export interface PricingTable {
  models: Record<string, ModelPricing>;
}

let table: PricingTable | undefined;

export function loadPricing(): PricingTable {
  table ??= JSON.parse(readAsset(PRICING_ASSET)) as PricingTable;
  return table;
}

export interface CostEstimate {
  usd: number | undefined;
  source: 'provider' | 'config' | 'unknown';
}

function normalizeModel(model: string): string {
  return model.replace(/^models\//, '').replace(/^google\//, '');
}

/** Tokens × rate from config/pricing.json; undefined when the model is not listed. */
export function priceFromConfig(
  model: string,
  usage: TokenUsage,
  now = new Date(),
  pricing: PricingTable = loadPricing(),
): number | undefined {
  const entry = pricing.models[normalizeModel(model)];
  if (!entry) return undefined;
  const today = now.toISOString().slice(0, 10);
  const period = entry.periods.find((p) => !p.until || today <= p.until);
  if (!period) return undefined;
  const long =
    entry.longContextThreshold !== undefined &&
    usage.inputTokens > entry.longContextThreshold &&
    period.longContext;
  const rates = long || period;
  return (usage.inputTokens * rates.input + usage.outputTokens * rates.output) / 1_000_000;
}

/**
 * OpenRouter: the real cost reported in providerMetadata. Google: tokens × configured rate.
 */
export function computeCost(
  provider: ProviderName,
  model: string,
  usage: TokenUsage,
  providerCostUsd: number | undefined,
  now = new Date(),
): CostEstimate {
  if (provider === 'openrouter' && providerCostUsd !== undefined) {
    return { usd: providerCostUsd, source: 'provider' };
  }
  const usd = priceFromConfig(model, usage, now);
  return usd === undefined ? { usd: undefined, source: 'unknown' } : { usd, source: 'config' };
}

export function formatCost(cost: CostEstimate): string {
  if (cost.usd === undefined) return 'n/a';
  const value = cost.usd < 0.01 ? cost.usd.toFixed(5) : cost.usd.toFixed(4);
  return cost.source === 'provider' ? `$${value}` : `~$${value}`;
}
