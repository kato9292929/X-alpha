import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XTokenManager, type RefreshResult } from '../src/ingest/xClient.js';

test('rotation across successive refreshes: persists each new value, always uses the latest', async () => {
  const rotated: string[] = [];
  // Server hands back a new refresh token each time (like X does).
  const issued: RefreshResult[] = [
    { accessToken: 'access1', refreshToken: 'refresh2' },
    { accessToken: 'access2', refreshToken: 'refresh3' },
  ];
  const usedRefreshTokens: string[] = [];
  let i = 0;
  const fakeRefresh = async (_id: string, _secret: string | undefined, rt: string): Promise<RefreshResult> => {
    usedRefreshTokens.push(rt);
    return issued[i++]!;
  };

  const mgr = new XTokenManager('cid', undefined, { refreshToken: 'refresh1' }, (t) => rotated.push(t), fakeRefresh);

  assert.equal(await mgr.getAccessToken(), 'access1'); // first refresh
  assert.equal(await mgr.refresh(), 'access2'); // second refresh (e.g. mid-run 401)

  // Each refresh used the LATEST refresh token, not the original.
  assert.deepEqual(usedRefreshTokens, ['refresh1', 'refresh2']);
  // Both rotations were persisted for write-back.
  assert.deepEqual(rotated, ['refresh2', 'refresh3']);
});

test('no rotation persisted when the server returns the same refresh token', async () => {
  const rotated: string[] = [];
  const fakeRefresh = async (): Promise<RefreshResult> => ({ accessToken: 'a', refreshToken: 'refresh1' });
  const mgr = new XTokenManager('cid', undefined, { refreshToken: 'refresh1' }, (t) => rotated.push(t), fakeRefresh);
  await mgr.getAccessToken();
  assert.deepEqual(rotated, [], 'unchanged token must not trigger a secret write-back');
});

test('existing access token is used without any refresh', async () => {
  let refreshCalls = 0;
  const fakeRefresh = async (): Promise<RefreshResult> => {
    refreshCalls++;
    return { accessToken: 'x', refreshToken: null };
  };
  const mgr = new XTokenManager('cid', undefined, { accessToken: 'preset', refreshToken: 'r' }, () => {}, fakeRefresh);
  assert.equal(await mgr.getAccessToken(), 'preset');
  assert.equal(refreshCalls, 0);
});
