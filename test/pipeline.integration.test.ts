/**
 * End-to-end logic run over offline fixtures (no network, no secrets):
 * synthetic claims -> Phase 3 scoreOne (FixtureSource prices) -> Phase 4
 * findDivergences (fixture osd holdings). Proves the scoring and divergence
 * pipelines actually execute and produce the expected verdicts.
 *
 * The claim texts here are synthetic own-words summaries authored for the test,
 * NOT copies of any real tweet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FixtureSource } from '../src/score/priceSource.js';
import { extractTickers } from '../src/divergence/osdClient.js';
import { findDivergences } from '../src/divergence/divergence.js';
import { scoreOne } from '../src/score/scoreClaims.js';
import { aggregateReputation, type ScoreRecord } from '../src/score/reputation.js';
import type { ClaimRecord } from '../src/extract/schema.js';
import { readFileSync } from 'node:fs';

const POSTED = '2025-12-15T00:00:00Z';
const TODAY = '2026-02-01';

function claim(partial: Partial<ClaimRecord> & Pick<ClaimRecord, 'tweet_id' | 'author_handle' | 'claim'>): ClaimRecord {
  return {
    source: 'x',
    author_id: 'id_' + partial.author_handle,
    posted_at: POSTED,
    captured_at: POSTED,
    scorable: true,
    tags: [],
    unscored_reason: null,
    ...partial,
  } as ClaimRecord;
}

const CLAIMS: ClaimRecord[] = [
  claim({
    tweet_id: 't_nvda',
    author_handle: 'alice',
    claim: { assets: ['NVDA'], direction: 'up', thesis: 'sees continued upside', condition: 'higher by judgment date', judgment_date: '2026-01-15', horizon: null },
  }),
  claim({
    tweet_id: 't_tsla',
    author_handle: 'bob',
    claim: { assets: ['TSLA'], direction: 'down', thesis: 'expects a pullback', condition: 'lower by judgment date', judgment_date: '2026-01-15', horizon: null },
  }),
  claim({
    tweet_id: 't_toyota',
    author_handle: 'carol',
    claim: { assets: ['7203.T'], direction: 'up', thesis: 'expects recovery', condition: 'higher within horizon', judgment_date: null, horizon: '1m' },
  }),
  claim({
    tweet_id: 't_amd',
    author_handle: 'dave',
    tags: ['fundamental'],
    claim: { assets: ['AMD'], direction: 'long', thesis: 'backlog-driven thesis', condition: 'data-center backlog exceeds a threshold', judgment_date: '2026-01-15', horizon: null },
  }),
];

test('Phase 3: price-directional claims scored; fundamental claim -> review_pending', async () => {
  const src = new FixtureSource('data/fixtures/prices.json');
  const results = new Map<string, Awaited<ReturnType<typeof scoreOne>>>();
  for (const c of CLAIMS) results.set(c.tweet_id, await scoreOne(c, src, TODAY, 0.02));

  assert.equal(results.get('t_nvda')!.verdict, 'hit'); // +30%
  assert.equal(results.get('t_tsla')!.verdict, 'miss'); // rose +10%, bearish call wrong
  assert.equal(results.get('t_toyota')!.verdict, 'hit'); // +5% via 1m horizon
  assert.equal(results.get('t_amd')!.method, 'review_pending');
  assert.equal(results.get('t_amd')!.verdict, 'review_pending'); // never auto hit/miss
});

test('Phase 3: reputation aggregation over the scored sample', async () => {
  const src = new FixtureSource('data/fixtures/prices.json');
  const scores: ScoreRecord[] = [];
  for (const c of CLAIMS) {
    const r = await scoreOne(c, src, TODAY, 0.02);
    if (r) scores.push({ ...r, scored_at: '2026-02-01T00:00:00Z' });
  }
  const rep = aggregateReputation(scores);
  const bob = rep.find((r) => r.author_handle === 'bob')!;
  assert.equal(bob.misses, 1);
  assert.equal(bob.hit_rate, 0);
});

test('Phase 4: ticker-level divergence with resolved winner', async () => {
  const usHoldings = extractTickers(JSON.parse(readFileSync('data/fixtures/osd_us.json', 'utf8')), 'us');
  const jpHoldings = extractTickers(JSON.parse(readFileSync('data/fixtures/osd_jp.json', 'utf8')), 'jp');
  const osd = [...usHoldings, ...jpHoldings];

  // Build a score record for the bearish TSLA claim so divergence can resolve.
  const src = new FixtureSource('data/fixtures/prices.json');
  const tslaScore = await scoreOne(CLAIMS[1]!, src, TODAY, 0.02);
  const scores: ScoreRecord[] = [{ ...tslaScore!, scored_at: '2026-02-01T00:00:00Z' }];

  const items = findDivergences(CLAIMS, osd, scores);
  // Only TSLA diverges: bob is bearish while osd holds TSLA long.
  assert.equal(items.length, 1);
  const d = items[0]!;
  assert.equal(d.ticker, 'TSLA');
  assert.equal(d.market, 'us');
  assert.equal(d.x_direction, 'down');
  assert.equal(d.resolved!.osd_side_right, true); // TSLA rose => long was right
  assert.equal(d.resolved!.x_side_right, false);
});

test('Phase 4: osd ticker extraction is tolerant of shape', () => {
  assert.deepEqual(extractTickers([{ symbol: 'aapl' }], 'us').map((h) => h.ticker), ['AAPL']);
  assert.deepEqual(extractTickers({ positions: [{ code: 'msft' }] }, 'us').map((h) => h.ticker), ['MSFT']);
});
