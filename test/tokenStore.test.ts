import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRotated, maskToken, reconcileRefreshToken, writeRotatedToken } from '../src/lib/tokenStore.js';

test('isRotated only true when a different non-empty token is returned', () => {
  assert.equal(isRotated('old', 'new'), true);
  assert.equal(isRotated('same', 'same'), false); // unchanged value
  assert.equal(isRotated('old', null), false); // none returned
  assert.equal(isRotated('old', ''), false); // empty
  assert.equal(isRotated(undefined, 'first'), true); // first-time value counts as rotated
});

test('maskToken never reveals the raw secret', () => {
  const secret = 'abcdef1234567890zzzz';
  const masked = maskToken(secret);
  assert.ok(!masked.includes('ef12345678'), 'middle of the secret must not appear');
  assert.match(masked, /^abcd….*len=20\)$/);
  assert.equal(maskToken(''), '(empty)');
  assert.equal(maskToken('short'), '**** (len=5)');
});

test('reconcileRefreshToken persists ONLY when the value changed', () => {
  const calls: string[] = [];
  const persist = (t: string) => calls.push(t);

  // rotated -> persisted, next advances
  let r = reconcileRefreshToken({ current: 'A', received: 'B', persist });
  assert.deepEqual(r, { next: 'B', rotated: true });
  assert.deepEqual(calls, ['B']);

  // same value -> not persisted
  r = reconcileRefreshToken({ current: 'B', received: 'B', persist });
  assert.deepEqual(r, { next: 'B', rotated: false });
  assert.equal(calls.length, 1, 'no extra persist for unchanged token');

  // no token returned -> keep current, not persisted
  r = reconcileRefreshToken({ current: 'B', received: null, persist });
  assert.deepEqual(r, { next: 'B', rotated: false });
  assert.equal(calls.length, 1);
});

test('writeRotatedToken writes exact bytes with no trailing newline', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'xalpha-tok-')), '.rotated-refresh-token');
  const token = 'rt_ABC123.def456';
  const written = writeRotatedToken(token, path);
  assert.equal(written, path);
  // Exact value, so `gh secret set ... < file` stores it verbatim.
  assert.equal(readFileSync(path, 'utf8'), token);
});
