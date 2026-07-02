import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addHorizon,
  resolveJudgmentDate,
  classify,
  scoreDirectional,
  scoreRelative,
  benchmarkFor,
} from '../src/score/verdict.js';
import type { Claim } from '../src/extract/schema.js';

test('addHorizon supports d/w/m/y', () => {
  assert.equal(addHorizon('2026-01-01', '30d'), '2026-01-31');
  assert.equal(addHorizon('2026-01-01', '2w'), '2026-01-15');
  assert.equal(addHorizon('2026-01-01', '3m'), '2026-04-01');
  assert.equal(addHorizon('2026-01-01', '1y'), '2027-01-01');
  assert.equal(addHorizon('2026-01-01', 'soon'), null);
});

test('resolveJudgmentDate prefers explicit date, falls back to horizon', () => {
  const base: Claim = { assets: ['X'], direction: 'up', thesis: '', condition: 'c', judgment_date: null, horizon: null };
  assert.equal(resolveJudgmentDate({ ...base, judgment_date: '2026-05-01' }, '2026-01-01'), '2026-05-01');
  assert.equal(resolveJudgmentDate({ ...base, horizon: '1m' }, '2026-01-01T09:00:00Z'), '2026-02-01');
  assert.equal(resolveJudgmentDate(base, '2026-01-01'), null);
});

test('classify: fundamental tag => review_pending; else by direction', () => {
  const c: Claim = { assets: ['X'], direction: 'up', thesis: '', condition: 'c', judgment_date: '2026-01-01', horizon: null };
  assert.equal(classify(c, ['fundamental']), 'review_pending');
  assert.equal(classify(c, []), 'price_direction');
  assert.equal(classify({ ...c, direction: 'outperform' }, []), 'relative');
  assert.equal(classify({ ...c, direction: 'neutral' }, []), 'review_pending');
});

test('scoreDirectional up/long and down/short with 2% band', () => {
  assert.equal(scoreDirectional('up', 100, 130, 0.02), 'hit');
  assert.equal(scoreDirectional('up', 100, 90, 0.02), 'miss');
  assert.equal(scoreDirectional('up', 100, 101, 0.02), 'partial');
  assert.equal(scoreDirectional('short', 100, 90, 0.02), 'hit'); // fell => short right
  assert.equal(scoreDirectional('short', 100, 110, 0.02), 'miss');
});

test('scoreRelative outperform/underperform vs benchmark', () => {
  assert.equal(scoreRelative('outperform', 0.1, 0.02, 0.02), 'hit');
  assert.equal(scoreRelative('outperform', 0.0, 0.05, 0.02), 'miss');
  assert.equal(scoreRelative('underperform', 0.0, 0.05, 0.02), 'hit');
});

test('benchmarkFor picks by market', () => {
  assert.equal(benchmarkFor('NVDA'), 'SPY');
  assert.equal(benchmarkFor('7203.T'), '1306.T');
});
