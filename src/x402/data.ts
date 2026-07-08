/**
 * Data layer for the x402 endpoints. Turns the append-only JSONL into:
 *  - active claims (scorable && judgment window not yet reached),
 *  - author_weight per handle (reputation.ts formula; null when no judged data),
 *  - aggregate.by_asset (the weighted-bias corpus that is the scarce good).
 *
 * Original text is NEVER emitted: claim.thesis and the raw tweet are excluded.
 */
import type { ClaimRecord, Claim, Direction } from '../extract/schema.js';
import { resolveJudgmentDate } from '../score/verdict.js';
import { aggregateReputation, type ScoreRecord } from '../score/reputation.js';

export interface AuthorWeight {
  hit_rate: number;
  sample_size: number;
  confidence: 'low' | 'medium' | 'high';
}

/** A claim returned in the paid payload. NO thesis, NO original text. */
export interface PublicClaim {
  assets: string[];
  direction: Direction;
  condition: string;
  judgment_date: string | null;
  horizon: string | null;
  posted_at: string;
  author_handle: string;
  author_weight: AuthorWeight | null;
}

export interface AssetAggregate {
  long: number;
  short: number;
  /** Weighted net bias in [-1, 1]: (Σ long w − Σ short w) / Σ w. 0 if no weight. */
  weighted_bias: number;
}

export interface ActivePayload {
  as_of: string;
  data_note: string | null;
  claims: PublicClaim[];
  aggregate: { by_asset: Record<string, AssetAggregate> };
}

const LONG: ReadonlySet<Direction> = new Set(['up', 'long', 'outperform']);
const SHORT: ReadonlySet<Direction> = new Set(['down', 'short', 'underperform']);

function confidenceFor(sampleSize: number): 'low' | 'medium' | 'high' {
  if (sampleSize >= 30) return 'high';
  if (sampleSize >= 10) return 'medium';
  return 'low';
}

/** Author weights keyed by handle. Null when there is no judged sample. */
export function authorWeights(scores: ScoreRecord[]): Map<string, AuthorWeight | null> {
  const out = new Map<string, AuthorWeight | null>();
  for (const rep of aggregateReputation(scores)) {
    if (rep.scored === 0 || rep.hit_rate === null) {
      out.set(rep.author_handle, null);
    } else {
      out.set(rep.author_handle, {
        hit_rate: Math.round(rep.hit_rate * 100) / 100,
        sample_size: rep.scored,
        confidence: confidenceFor(rep.scored),
      });
    }
  }
  return out;
}

/** True when the claim is scorable and its judgment window has not passed. */
export function isActive(rec: ClaimRecord, todayISO: string): rec is ClaimRecord & { claim: Claim } {
  if (!rec.scorable || !rec.claim) return false;
  const jd = resolveJudgmentDate(rec.claim, rec.posted_at);
  return jd !== null && jd > todayISO;
}

export function activeClaims(claims: ClaimRecord[], todayISO: string): Array<ClaimRecord & { claim: Claim }> {
  return claims.filter((r): r is ClaimRecord & { claim: Claim } => isActive(r, todayISO));
}

/** Map a direction to a side, or null if not directional. */
function sideOf(d: Direction): 'long' | 'short' | null {
  if (LONG.has(d)) return 'long';
  if (SHORT.has(d)) return 'short';
  return null;
}

export function buildAggregate(
  actives: Array<ClaimRecord & { claim: Claim }>,
  weights: Map<string, AuthorWeight | null>,
): Record<string, AssetAggregate> {
  // Accumulate per asset: side counts and weighted sums.
  const acc = new Map<string, { long: number; short: number; wLong: number; wShort: number }>();
  for (const rec of actives) {
    const side = sideOf(rec.claim.direction);
    if (!side) continue;
    const w = weights.get(rec.author_handle)?.hit_rate ?? 0.5; // unknown track record => neutral weight
    for (const asset of rec.claim.assets) {
      const a = acc.get(asset) ?? { long: 0, short: 0, wLong: 0, wShort: 0 };
      if (side === 'long') {
        a.long++;
        a.wLong += w;
      } else {
        a.short++;
        a.wShort += w;
      }
      acc.set(asset, a);
    }
  }
  const out: Record<string, AssetAggregate> = {};
  for (const [asset, a] of acc) {
    const wTotal = a.wLong + a.wShort;
    const bias = wTotal === 0 ? 0 : (a.wLong - a.wShort) / wTotal;
    out[asset] = { long: a.long, short: a.short, weighted_bias: Math.round(bias * 100) / 100 };
  }
  return out;
}

export function buildActivePayload(
  claims: ClaimRecord[],
  scores: ScoreRecord[],
  nowISO: string,
): ActivePayload {
  const todayISO = nowISO.slice(0, 10);
  const weights = authorWeights(scores);
  const actives = activeClaims(claims, todayISO);
  const publicClaims: PublicClaim[] = actives.map((rec) => ({
    assets: rec.claim.assets,
    direction: rec.claim.direction,
    condition: rec.claim.condition,
    judgment_date: rec.claim.judgment_date,
    horizon: rec.claim.horizon,
    posted_at: rec.posted_at,
    author_handle: rec.author_handle,
    author_weight: weights.get(rec.author_handle) ?? null,
  }));
  return {
    as_of: nowISO,
    data_note: scores.length === 0 ? 'no judged scores yet; author_weight is null until scores-history accrues' : null,
    claims: publicClaims,
    aggregate: { by_asset: buildAggregate(actives, weights) },
  };
}

export interface ClaimsMeta {
  active_claim_count: number;
  assets: Record<string, number>;
  author_count: number;
  latest_captured_at: string | null;
  data_note: string | null;
}

/** Free discovery metadata. No claim bodies. */
export function buildClaimsMeta(claims: ClaimRecord[], nowISO: string): ClaimsMeta {
  const actives = activeClaims(claims, nowISO.slice(0, 10));
  const assets: Record<string, number> = {};
  const authors = new Set<string>();
  let latest: string | null = null;
  for (const rec of actives) {
    authors.add(rec.author_handle);
    for (const a of rec.claim.assets) assets[a] = (assets[a] ?? 0) + 1;
    if (rec.captured_at && (latest === null || rec.captured_at > latest)) latest = rec.captured_at;
  }
  return {
    active_claim_count: actives.length,
    assets,
    author_count: authors.size,
    latest_captured_at: latest,
    data_note: claims.length === 0 ? 'no claims recorded yet (claims-history.jsonl not present/committed)' : null,
  };
}
