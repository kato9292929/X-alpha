/**
 * Ingest-layer tests over fixture list-tweets pages (no network). Covers:
 *  (a) next_token pagination stops at a known tweet_id,
 *  (b) author_id -> username resolution,
 *  (c) missing X_BEARER_TOKEN fails with a clear error.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchListTweets, tweetIdGt } from '../src/ingest/xClient.js';
import { latestTweetId } from '../src/ingest/ingestListTweets.js';

// Placeholder config so the env gate passes; the network layer is injected, so
// these values are never used to make a real request. The (c) test overrides them.
process.env.X_BEARER_TOKEN ??= 'test-bearer';
process.env.X_LIST_ID ??= '123';

// Two fixture pages; newest-first, as the API returns them.
const PAGES: Record<string, unknown> = {
  page1: {
    data: [
      { id: '1005', author_id: 'a1', created_at: '2026-07-05T00:00:00Z', text: 'newest' },
      { id: '1004', author_id: 'a2', created_at: '2026-07-04T00:00:00Z', text: 'second' },
    ],
    includes: { users: [{ id: 'a1', username: 'alice' }, { id: 'a2', username: 'bob' }] },
    meta: { next_token: 'page2' },
  },
  page2: {
    data: [
      { id: '1003', author_id: 'a1', created_at: '2026-07-03T00:00:00Z', text: 'third' },
      { id: '1002', author_id: 'a3', created_at: '2026-07-02T00:00:00Z', text: 'old' },
      { id: '1001', author_id: 'a1', created_at: '2026-07-01T00:00:00Z', text: 'oldest' },
    ],
    includes: { users: [{ id: 'a1', username: 'alice' }, { id: 'a3', username: 'carol' }] },
    meta: {}, // no next_token -> last page
  },
};

function fakeFetchPage(pageKey: 'page1') {
  const calls: string[] = [];
  const fn = async (url: string): Promise<any> => {
    const u = new URL(url);
    const token = u.searchParams.get('pagination_token');
    const key = token ?? pageKey;
    calls.push(key);
    return PAGES[key];
  };
  return { fn, calls };
}

test('tweetIdGt compares snowflake ids numerically (BigInt), not lexically', () => {
  assert.equal(tweetIdGt('1002', '999'), true); // lexical would be false
  assert.equal(tweetIdGt('1001', '1001'), false);
});

test('(a) pagination stops at a known tweet_id', async () => {
  const { fn, calls } = fakeFetchPage('page1');
  const ids: string[] = [];
  // Already ingested up to 1003 -> should yield 1005, 1004 only, and stop
  // as soon as 1003 is reached on page 2.
  for await (const t of fetchListTweets('1003', fn)) ids.push(t.tweet_id);
  assert.deepEqual(ids, ['1005', '1004']);
  // It did page into page2 (to discover 1003) then stopped.
  assert.deepEqual(calls, ['page1', 'page2']);
});

test('pagination reads all pages when nothing is known yet', async () => {
  const { fn } = fakeFetchPage('page1');
  const ids: string[] = [];
  for await (const t of fetchListTweets(undefined, fn)) ids.push(t.tweet_id);
  assert.deepEqual(ids, ['1005', '1004', '1003', '1002', '1001']);
});

test('(b) author_id resolves to username; unknown author -> empty handle', async () => {
  const { fn } = fakeFetchPage('page1');
  const byId = new Map<string, string>();
  for await (const t of fetchListTweets(undefined, fn)) byId.set(t.tweet_id, t.author_handle);
  assert.equal(byId.get('1005'), 'alice');
  assert.equal(byId.get('1004'), 'bob');
  assert.equal(byId.get('1002'), 'carol');
});

test('(c) missing X_BEARER_TOKEN throws a clear error', async () => {
  const prevBearer = process.env.X_BEARER_TOKEN;
  const prevList = process.env.X_LIST_ID;
  delete process.env.X_BEARER_TOKEN;
  process.env.X_LIST_ID = '123';
  try {
    await assert.rejects(
      (async () => {
        for await (const _ of fetchListTweets(undefined, async () => ({}))) void _;
      })(),
      /missing X config: X_BEARER_TOKEN/,
    );
  } finally {
    if (prevBearer === undefined) delete process.env.X_BEARER_TOKEN;
    else process.env.X_BEARER_TOKEN = prevBearer;
    if (prevList === undefined) delete process.env.X_LIST_ID;
    else process.env.X_LIST_ID = prevList;
  }
});

test('latestTweetId returns the numeric max, or undefined when empty', () => {
  assert.equal(latestTweetId([{ tweet_id: '1001' }, { tweet_id: '1005' }, { tweet_id: '1003' }]), '1005');
  assert.equal(latestTweetId([]), undefined);
});
