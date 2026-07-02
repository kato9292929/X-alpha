/**
 * Falsifiability filter (Phase 2). A claim is scorable only when it has enough
 * structure to be resolved against primary data later: at least one asset, a
 * resolvable direction, a falsification condition, and a judgment window
 * (explicit date OR a horizon). Everything else is kept, unscored, with a tag
 * and a reason so nothing is silently dropped.
 */
import type { Claim } from './schema.js';

export interface FalsifiabilityResult {
  scorable: boolean;
  reason: string | null;
}

export function evaluateFalsifiability(claim: Claim | null): FalsifiabilityResult {
  if (!claim) return { scorable: false, reason: 'no_structured_claim' };

  const missing: string[] = [];
  if (!claim.assets || claim.assets.length === 0) missing.push('assets');
  if (!claim.direction || claim.direction === 'unknown' || claim.direction === 'neutral')
    missing.push('resolvable_direction');
  if (!claim.condition || claim.condition.trim().length === 0) missing.push('condition');

  const hasWindow = Boolean((claim.judgment_date && claim.judgment_date.trim()) || (claim.horizon && claim.horizon.trim()));
  if (!hasWindow) missing.push('judgment_window');

  if (missing.length > 0) {
    return { scorable: false, reason: `missing:${missing.join(',')}` };
  }
  return { scorable: true, reason: null };
}
