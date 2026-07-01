import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseModelJson } from '../src/extract/claudeClient.js';

test('parseModelJson extracts JSON and coerces direction', () => {
  const text = 'Here is the result:\n{"claim":{"assets":["NVDA"],"direction":"UP","thesis":"sees upside","condition":"price above entry by date","judgment_date":"2026-03-01","horizon":null},"tags":["momentum"],"unscored_reason":null}\nDone.';
  const out = parseModelJson(text);
  assert.equal(out.claim!.direction, 'up'); // lowercased/coerced
  assert.deepEqual(out.claim!.assets, ['NVDA']);
  assert.deepEqual(out.tags, ['momentum']);
});

test('parseModelJson maps unknown directions to "unknown"', () => {
  const out = parseModelJson('{"claim":{"assets":["X"],"direction":"moon","thesis":"t","condition":"c","judgment_date":null,"horizon":"1m"},"tags":[],"unscored_reason":null}');
  assert.equal(out.claim!.direction, 'unknown');
});

test('parseModelJson handles null claim (non-prediction post)', () => {
  const out = parseModelJson('{"claim":null,"tags":["sentiment","context"],"unscored_reason":"no checkable prediction"}');
  assert.equal(out.claim, null);
  assert.deepEqual(out.tags, ['sentiment', 'context']);
});

test('parseModelJson flags missing JSON instead of throwing', () => {
  const out = parseModelJson('the model returned prose only');
  assert.equal(out.claim, null);
  assert.deepEqual(out.tags, ['parse_error']);
});
