import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFalsifiability } from '../src/extract/falsifiability.js';
import type { Claim } from '../src/extract/schema.js';

const full: Claim = {
  assets: ['NVDA'],
  direction: 'up',
  thesis: 'expects continued upside on demand',
  condition: 'price higher than entry by judgment date',
  judgment_date: '2026-03-01',
  horizon: null,
};

test('complete claim is scorable', () => {
  assert.equal(evaluateFalsifiability(full).scorable, true);
});

test('null claim is not scorable', () => {
  const r = evaluateFalsifiability(null);
  assert.equal(r.scorable, false);
  assert.equal(r.reason, 'no_structured_claim');
});

test('missing assets makes it unscorable', () => {
  const r = evaluateFalsifiability({ ...full, assets: [] });
  assert.equal(r.scorable, false);
  assert.match(r.reason!, /assets/);
});

test('neutral direction is not resolvable', () => {
  const r = evaluateFalsifiability({ ...full, direction: 'neutral' });
  assert.equal(r.scorable, false);
  assert.match(r.reason!, /resolvable_direction/);
});

test('no judgment date and no horizon => no window', () => {
  const r = evaluateFalsifiability({ ...full, judgment_date: null, horizon: null });
  assert.equal(r.scorable, false);
  assert.match(r.reason!, /judgment_window/);
});

test('horizon alone is a valid window', () => {
  const r = evaluateFalsifiability({ ...full, judgment_date: null, horizon: '3m' });
  assert.equal(r.scorable, true);
});
