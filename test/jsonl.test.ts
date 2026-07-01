import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendNew, readJsonl } from '../src/lib/jsonl.js';

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'xalpha-')), 'store.jsonl');
}

test('append-only dedup by key, prior lines untouched', () => {
  const path = tmpFile();
  const key = (r: { id: string }) => r.id;

  let res = appendNew(path, [{ id: 'a', v: 1 }, { id: 'b', v: 2 }], key);
  assert.deepEqual(res, { appended: 2, skipped: 0 });

  // Re-append a duplicate + a new one: duplicate skipped, original value kept.
  res = appendNew(path, [{ id: 'a', v: 999 }, { id: 'c', v: 3 }], key);
  assert.deepEqual(res, { appended: 1, skipped: 1 });

  const rows = readJsonl<{ id: string; v: number }>(path);
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b', 'c']);
  assert.equal(rows.find((r) => r.id === 'a')!.v, 1, 'existing record must not be rewritten');

  // File is genuinely append-only text (3 lines).
  assert.equal(readFileSync(path, 'utf8').trim().split('\n').length, 3);
});

test('reading a missing file yields empty array', () => {
  assert.deepEqual(readJsonl('/does/not/exist.jsonl'), []);
});
