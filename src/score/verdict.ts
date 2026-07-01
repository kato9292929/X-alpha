/**
 * Pure scoring decisions (no I/O), so they are fully unit-testable.
 * A claim is scored only when it can be resolved from price data. Complex
 * fundamental conditions are never auto-scored — they become 'review_pending'.
 */
import type { Claim, Direction } from '../extract/schema.js';
import { PRICE_DIRECTIONAL, RELATIVE_DIRECTIONAL, REVIEW_TAGS } from '../extract/schema.js';

export type Verdict = 'hit' | 'miss' | 'partial' | 'review_pending' | 'undetermined';
export type Method = 'price_direction' | 'relative' | 'review_pending';

/** Add a horizon like "30d","3m","1y","2w" to an ISO date. null if unparseable. */
export function addHorizon(dateISO: string, horizon: string): string | null {
  const m = /^(\d+)\s*([dwmy])$/i.exec(horizon.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  const d = new Date(dateISO + 'T00:00:00Z');
  if (unit === 'd') d.setUTCDate(d.getUTCDate() + n);
  else if (unit === 'w') d.setUTCDate(d.getUTCDate() + n * 7);
  else if (unit === 'm') d.setUTCMonth(d.getUTCMonth() + n);
  else if (unit === 'y') d.setUTCFullYear(d.getUTCFullYear() + n);
  return d.toISOString().slice(0, 10);
}

/** Resolve the date a claim should be judged on. */
export function resolveJudgmentDate(claim: Claim, postedAtISO: string): string | null {
  if (claim.judgment_date) return claim.judgment_date;
  if (claim.horizon) return addHorizon(postedAtISO.slice(0, 10), claim.horizon);
  return null;
}

/** How this claim would be scored, given its direction and tags. */
export function classify(claim: Claim, tags: string[]): Method {
  if (tags.some((t) => REVIEW_TAGS.has(t))) return 'review_pending';
  if (PRICE_DIRECTIONAL.has(claim.direction)) return 'price_direction';
  if (RELATIVE_DIRECTIONAL.has(claim.direction)) return 'relative';
  return 'review_pending';
}

/** Absolute price-direction scoring. band is the partial dead-zone (e.g. 0.02). */
export function scoreDirectional(direction: Direction, start: number, end: number, band: number): Verdict {
  const ret = end / start - 1;
  const bullish = direction === 'up' || direction === 'long';
  const signed = bullish ? ret : -ret; // reward for being right in the stated direction
  if (signed >= band) return 'hit';
  if (signed <= -band) return 'miss';
  return 'partial';
}

/** Relative scoring vs a benchmark return. */
export function scoreRelative(direction: Direction, assetRet: number, benchRet: number, band: number): Verdict {
  const diff = assetRet - benchRet;
  const wantsOut = direction === 'outperform';
  const signed = wantsOut ? diff : -diff;
  if (signed >= band) return 'hit';
  if (signed <= -band) return 'miss';
  return 'partial';
}

/** Default benchmark ticker for a market inferred from the asset ticker. */
export function benchmarkFor(ticker: string): string {
  return /\.T$/i.test(ticker) ? '1306.T' : 'SPY';
}
