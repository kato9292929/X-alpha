/**
 * Structured claim schema. IMPORTANT: no field ever holds the original tweet
 * text. `thesis` is Claude's own-words summary and must not reproduce the
 * source. We keep only ids, author, timestamps, and the structured claim.
 */

/** Directions the scorer understands. */
export type Direction =
  | 'up'
  | 'down'
  | 'long'
  | 'short'
  | 'outperform'
  | 'underperform'
  | 'neutral'
  | 'unknown';

export const PRICE_DIRECTIONAL: ReadonlySet<Direction> = new Set(['up', 'down', 'long', 'short']);
export const RELATIVE_DIRECTIONAL: ReadonlySet<Direction> = new Set(['outperform', 'underperform']);

/** Tags that force a claim into human/LLM review instead of auto price scoring. */
export const REVIEW_TAGS: ReadonlySet<string> = new Set(['fundamental', 'complex_condition', 'event', 'qualitative']);

export interface Claim {
  /** e.g. ["NVDA"] or ["7203.T"]. */
  assets: string[];
  direction: Direction;
  /** Claude's own-words summary of the thesis. NOT a copy of the tweet. */
  thesis: string;
  /** The falsification condition (what would prove it right/wrong). */
  condition: string;
  /** ISO date (YYYY-MM-DD) the claim should be judged on, or null. */
  judgment_date: string | null;
  /** Free-form horizon (e.g. "3m", "by end of FY2026") when no explicit date. */
  horizon: string | null;
}

export interface ClaimRecord {
  source: 'x';
  tweet_id: string;
  author_handle: string;
  author_id: string;
  /** Tweet creation time (ISO). */
  posted_at: string;
  /** When we ingested it (ISO). */
  captured_at: string;
  /** True only when the claim is falsifiable enough to score. */
  scorable: boolean;
  claim: Claim | null;
  tags: string[];
  /** Why it is not scorable (present when scorable=false). */
  unscored_reason: string | null;
}

/** Raw bookmark record persisted in Phase 1. Deliberately has NO body text. */
export interface BookmarkRaw {
  source: 'x';
  tweet_id: string;
  author_handle: string;
  author_id: string;
  created_at: string;
  captured_at: string;
}
