/**
 * x402 endpoint tests (no network). Covers the §6 acceptance points:
 *  (a) meta layer counts + asset list,
 *  (b) 402 non-empty accepts incl. v1 leg, CAIP-2 v2 network, atomic amount,
 *      asset/payTo = §6 values, transport = base64 in PAYMENT-REQUIRED + body {},
 *  (c) accepts built statically (no facilitator/getSupported call),
 *  (d) scores absent => author_weight null,
 *  (e) original text / thesis never leak,
 *  (f) unverified PAYMENT-SIGNATURE never yields a passthrough 200.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { x402Config } from '../src/x402/config.js';
import { buildRequirements, encodeRequirementsHeader } from '../src/x402/accepts.js';
import { buildActivePayload, buildClaimsMeta } from '../src/x402/data.js';
import { handleActive, handleClaims, type Deps } from '../src/x402/handler.js';
import type { Facilitator } from '../src/x402/payment.js';
import type { ClaimRecord } from '../src/extract/schema.js';
import type { ScoreRecord } from '../src/score/reputation.js';

const NOW = '2026-07-08T00:00:00Z';
const RESOURCE = 'https://x-alpha.example/claims/active';

function claim(over: Partial<ClaimRecord> & { tweet_id: string; author_handle: string; claim: ClaimRecord['claim'] }): ClaimRecord {
  return {
    source: 'x',
    author_id: 'id_' + over.author_handle,
    posted_at: '2026-07-06T00:00:00Z',
    captured_at: '2026-07-07T00:00:00Z',
    scorable: true,
    tags: [],
    unscored_reason: null,
    ...over,
  } as ClaimRecord;
}

const CLAIMS: ClaimRecord[] = [
  claim({
    tweet_id: 't_nvda',
    author_handle: 'alice',
    claim: { assets: ['NVDA'], direction: 'long', thesis: 'SECRET-THESIS-NVDA', condition: '> 180 close', judgment_date: '2026-08-05', horizon: null },
  }),
  claim({
    tweet_id: 't_nvda_bear',
    author_handle: 'bob',
    claim: { assets: ['NVDA'], direction: 'short', thesis: 'SECRET-THESIS-BEAR', condition: '< 150 close', judgment_date: '2026-08-05', horizon: null },
  }),
  // Already-judged window (past) -> NOT active.
  claim({
    tweet_id: 't_old',
    author_handle: 'carol',
    claim: { assets: ['TSLA'], direction: 'up', thesis: 'x', condition: 'up', judgment_date: '2026-06-01', horizon: null },
  }),
];

function deps(claims: ClaimRecord[], scores: ScoreRecord[], facilitator: Facilitator): Deps {
  return { cfg: x402Config(), loadClaims: () => claims, loadScores: () => scores, now: () => NOW, facilitator };
}

const NEVER_CALLED: Facilitator = {
  verify: () => { throw new Error('facilitator must not be called for 402/meta'); },
  settle: () => { throw new Error('facilitator must not be called for 402/meta'); },
};

test('(a) meta layer: active count, per-asset counts, author count', () => {
  const meta = buildClaimsMeta(CLAIMS, NOW);
  assert.equal(meta.active_claim_count, 2); // TSLA one is past-window
  assert.deepEqual(meta.assets, { NVDA: 2 });
  assert.equal(meta.author_count, 2);
  const res = handleClaims(deps(CLAIMS, [], NEVER_CALLED), RESOURCE);
  const body = JSON.parse(res.body);
  assert.equal(res.status, 200);
  assert.equal(body._hint.paid_path, '/claims/active');
  assert.equal(body._hint.price_atomic, '10000');
});

test('(b) 402 form matches §6: non-empty accepts, v1 leg, CAIP-2, atomic amount, transport', async () => {
  const res = await handleActive(deps(CLAIMS, [], NEVER_CALLED), RESOURCE); // no PAYMENT-SIGNATURE
  assert.equal(res.status, 402);
  assert.equal(res.body, '{}', 'v2 transport: body is {}');
  const header = res.headers['PAYMENT-REQUIRED'];
  assert.ok(header, 'requirements go in the PAYMENT-REQUIRED header');
  const reqs = JSON.parse(Buffer.from(header!, 'base64').toString('utf8'));
  assert.equal(reqs.x402Version, 2);
  assert.equal(reqs.accepts.length, 2, 'v1 + v2 legs');
  const [v1, v2] = reqs.accepts;
  assert.equal(v1.network, 'solana', 'v1 leg present (current AA needs it)');
  assert.equal(v2.network, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'v2 CAIP-2');
  for (const leg of reqs.accepts) {
    assert.equal(leg.scheme, 'exact');
    assert.equal(leg.amount, '10000'); // atomic units string, not "0.01"
    assert.equal(leg.asset, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    assert.equal(leg.payTo, '4s8XQC2WzRfgH8Xiep7ybnCW11VKRCMwxQF6jknx3VPf');
    assert.ok('extra' in leg && 'feePayer' in leg.extra && 'resource' in leg.extra);
  }
});

test('(c) accepts are static (no facilitator call to build the 402)', async () => {
  // NEVER_CALLED throws if verify/settle run; a clean 402 proves static build.
  const res = await handleActive(deps(CLAIMS, [], NEVER_CALLED), RESOURCE);
  assert.equal(res.status, 402);
  // Same output with an empty data set — build does not depend on data/network.
  const reqs = buildRequirements(x402Config(), RESOURCE);
  assert.equal(encodeRequirementsHeader(reqs), res.headers['PAYMENT-REQUIRED']);
});

test('(d) no scores => author_weight is null (never fabricated)', () => {
  const payload = buildActivePayload(CLAIMS, [], NOW);
  for (const c of payload.claims) assert.equal(c.author_weight, null);
  assert.match(payload.data_note ?? '', /author_weight is null/);
});

test('author_weight fills from scores (reputation.ts formula)', () => {
  const scores: ScoreRecord[] = [
    scoreRec('alice', 'hit'), scoreRec('alice', 'hit'), scoreRec('alice', 'miss'),
  ];
  const payload = buildActivePayload(CLAIMS, scores, NOW);
  const alice = payload.claims.find((c) => c.author_handle === 'alice')!;
  assert.equal(alice.author_weight!.sample_size, 3);
  assert.equal(alice.author_weight!.hit_rate, 0.67); // (2+0)/3 rounded
});

test('(e) original text and thesis never appear in any response', async () => {
  const okFac: Facilitator = {
    verify: async () => ({ valid: true }),
    settle: async () => ({ success: true, txSignature: 'base58sig' }),
  };
  const paid = await handleActive(deps(CLAIMS, [], okFac), RESOURCE, 'SIG');
  assert.equal(paid.status, 200);
  assert.doesNotMatch(paid.body, /SECRET-THESIS/);
  assert.doesNotMatch(paid.body, /thesis/);
  const meta = handleClaims(deps(CLAIMS, [], NEVER_CALLED), RESOURCE);
  assert.doesNotMatch(meta.body, /SECRET-THESIS/);
});

test('(f) unverified PAYMENT-SIGNATURE never returns 200 (verify fails)', async () => {
  const rejectFac: Facilitator = {
    verify: async () => ({ valid: false, reason: 'bad_sig' }),
    settle: async () => { throw new Error('settle must not run after verify fails'); },
  };
  const res = await handleActive(deps(CLAIMS, [], rejectFac), RESOURCE, 'SIG');
  assert.notEqual(res.status, 200);
  assert.equal(res.status, 402);
  assert.ok(res.headers['PAYMENT-RESPONSE'], 'failure still returns PAYMENT-RESPONSE');
});

test('(f2) verify ok but settle fails => still not 200', async () => {
  const fac: Facilitator = {
    verify: async () => ({ valid: true }),
    settle: async () => ({ success: false, reason: 'settle_revert' }),
  };
  const res = await handleActive(deps(CLAIMS, [], fac), RESOURCE, 'SIG');
  assert.notEqual(res.status, 200);
  assert.ok(res.headers['PAYMENT-RESPONSE']);
});

function scoreRec(handle: string, verdict: ScoreRecord['verdict']): ScoreRecord {
  return {
    tweet_id: handle + verdict + Math.round(Math.abs(Math.sin(handle.length + verdict.length))),
    author_handle: handle,
    author_id: 'id_' + handle,
    scored_at: NOW,
    judgment_date: '2026-07-01',
    method: 'price_direction',
    assets: ['NVDA'],
    direction: 'long',
    verdict,
    detail: {},
    price_source: 'fixture',
  };
}
