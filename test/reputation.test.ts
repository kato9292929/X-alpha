import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateReputation, type ScoreRecord } from '../src/score/reputation.js';

function rec(author: string, verdict: ScoreRecord['verdict']): ScoreRecord {
  return {
    tweet_id: author + verdict + Math.round(Math.abs(Math.sin(author.length))),
    author_handle: author,
    author_id: 'id_' + author,
    scored_at: '2026-02-01T00:00:00Z',
    judgment_date: '2026-01-15',
    method: 'price_direction',
    assets: ['X'],
    direction: 'up',
    verdict,
    detail: {},
    price_source: 'fixture',
  };
}

test('hit_rate counts partial as 0.5 and excludes review/undetermined', () => {
  const recs = [
    { ...rec('alice', 'hit'), tweet_id: '1' },
    { ...rec('alice', 'hit'), tweet_id: '2' },
    { ...rec('alice', 'partial'), tweet_id: '3' },
    { ...rec('alice', 'miss'), tweet_id: '4' },
    { ...rec('alice', 'review_pending'), tweet_id: '5' },
  ];
  const [a] = aggregateReputation(recs);
  assert.equal(a!.author_handle, 'alice');
  assert.equal(a!.scored, 4); // review_pending excluded
  assert.equal(a!.hits, 2);
  assert.equal(a!.partials, 1);
  assert.equal(a!.misses, 1);
  assert.equal(a!.review_pending, 1);
  assert.equal(a!.hit_rate, (2 + 0.5) / 4);
});

test('author with no resolved scores has null hit_rate', () => {
  const [a] = aggregateReputation([{ ...rec('bob', 'undetermined'), tweet_id: 'u1' }]);
  assert.equal(a!.hit_rate, null);
  assert.equal(a!.scored, 0);
});
