/**
 * Divergence logic (Phase 4), pure and testable. v0 matches on exact ticker.
 * osd holdings are LONG; an X claim diverges when it is bearish on a ticker osd
 * holds. When the judgment window has passed and a score exists, we also note
 * which side was right — from the realized return, not opinion.
 *
 * Theme-level matching (e.g. "memory semis") is deferred to v1.
 */
import type { ClaimRecord, Direction } from '../extract/schema.js';
import type { OsdHolding } from './osdClient.js';
import type { ScoreRecord } from '../score/reputation.js';

const BEARISH: ReadonlySet<Direction> = new Set(['down', 'short', 'underperform']);

export interface DivergenceItem {
  ticker: string;
  market: 'us' | 'jp';
  osd_side: 'long';
  x_tweet_id: string;
  x_author_handle: string;
  x_direction: Direction;
  x_thesis: string; // own-words summary (never original text)
  judgment_date: string | null;
  /** Present only when a score exists for the X claim. */
  resolved?: {
    asset_return: number | null;
    x_side_right: boolean | null; // bearish call right if return < 0
    osd_side_right: boolean | null; // long right if return > 0
    x_verdict: string;
  };
}

export function findDivergences(
  claims: ClaimRecord[],
  osd: OsdHolding[],
  scores: ScoreRecord[],
): DivergenceItem[] {
  const osdByTicker = new Map(osd.map((h) => [h.ticker.toUpperCase(), h]));
  const scoreByTweet = new Map(scores.map((s) => [s.tweet_id, s]));
  const out: DivergenceItem[] = [];

  for (const rec of claims) {
    if (!rec.scorable || !rec.claim) continue;
    if (!BEARISH.has(rec.claim.direction)) continue; // only opposite-of-long is a divergence
    for (const asset of rec.claim.assets) {
      const hit = osdByTicker.get(asset.toUpperCase());
      if (!hit) continue;
      const item: DivergenceItem = {
        ticker: hit.ticker,
        market: hit.market,
        osd_side: 'long',
        x_tweet_id: rec.tweet_id,
        x_author_handle: rec.author_handle,
        x_direction: rec.claim.direction,
        x_thesis: rec.claim.thesis,
        judgment_date: rec.claim.judgment_date,
      };
      const score = scoreByTweet.get(rec.tweet_id);
      if (score && (score.verdict === 'hit' || score.verdict === 'miss' || score.verdict === 'partial')) {
        const ret = typeof score.detail.assetRet === 'number' ? (score.detail.assetRet as number) : null;
        item.resolved = {
          asset_return: ret,
          x_side_right: ret == null ? null : ret < 0,
          osd_side_right: ret == null ? null : ret > 0,
          x_verdict: score.verdict,
        };
      }
      out.push(item);
    }
  }
  return out;
}
