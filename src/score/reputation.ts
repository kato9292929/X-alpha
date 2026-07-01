/**
 * Reputation aggregation (Phase 3). Pure function over score records. Neutral:
 * only counts of hit/miss/partial per author. partial counts as 0.5 in the
 * hit-rate; review_pending/undetermined are excluded from the rate.
 */
export interface ScoreRecord {
  tweet_id: string;
  author_handle: string;
  author_id: string;
  scored_at: string;
  judgment_date: string;
  method: string;
  assets: string[];
  direction: string;
  verdict: 'hit' | 'miss' | 'partial' | 'review_pending' | 'undetermined';
  detail: Record<string, unknown>;
  price_source: string;
}

export interface AuthorReputation {
  author_handle: string;
  author_id: string;
  scored: number; // hit+miss+partial
  hits: number;
  misses: number;
  partials: number;
  review_pending: number;
  undetermined: number;
  hit_rate: number | null; // (hits + 0.5*partials) / scored, null if scored==0
}

export function aggregateReputation(records: ScoreRecord[]): AuthorReputation[] {
  const byAuthor = new Map<string, AuthorReputation>();
  for (const r of records) {
    const key = r.author_id || r.author_handle;
    let a = byAuthor.get(key);
    if (!a) {
      a = {
        author_handle: r.author_handle,
        author_id: r.author_id,
        scored: 0,
        hits: 0,
        misses: 0,
        partials: 0,
        review_pending: 0,
        undetermined: 0,
        hit_rate: null,
      };
      byAuthor.set(key, a);
    }
    if (r.verdict === 'hit') a.hits++;
    else if (r.verdict === 'miss') a.misses++;
    else if (r.verdict === 'partial') a.partials++;
    else if (r.verdict === 'review_pending') a.review_pending++;
    else if (r.verdict === 'undetermined') a.undetermined++;
  }
  for (const a of byAuthor.values()) {
    a.scored = a.hits + a.misses + a.partials;
    a.hit_rate = a.scored === 0 ? null : (a.hits + 0.5 * a.partials) / a.scored;
  }
  return [...byAuthor.values()].sort((x, y) => (y.hit_rate ?? -1) - (x.hit_rate ?? -1));
}
