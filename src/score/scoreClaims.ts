/**
 * Phase 3 entrypoint (meant to run on a cron). Scores claims whose judgment
 * date has passed, using primary price data. Price-directional and relative
 * claims are auto-scored; anything tagged fundamental/complex is left as
 * 'review_pending' — never auto hit/miss. Results and a reputation snapshot are
 * appended (append-only).
 *
 * Run: npm run score        (X_ALPHA_PRICE_SOURCE=fixture for offline dry-run)
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { readJsonl, appendNew, existingKeys } from '../lib/jsonl.js';
import { makePriceSource, type PriceSource } from './priceSource.js';
import { classify, resolveJudgmentDate, scoreDirectional, scoreRelative, benchmarkFor, type Verdict } from './verdict.js';
import { aggregateReputation, type ScoreRecord } from './reputation.js';
import { priceConfig } from '../config/env.js';
import { log } from '../lib/log.js';
import { isMain } from '../lib/isMain.js';
import type { ClaimRecord } from '../extract/schema.js';

const CLAIMS_PATH = 'data/claims-history.jsonl';
const SCORES_PATH = 'data/scores-history.jsonl';
const REPUTATION_PATH = 'data/reputation-history.jsonl';

function band(): number {
  const v = Number(process.env.X_ALPHA_BAND);
  return Number.isFinite(v) && v > 0 ? v : 0.02;
}

function today(): string {
  return (process.env.X_ALPHA_TODAY ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
}

export async function scoreOne(
  rec: ClaimRecord,
  src: PriceSource,
  todayISO: string,
  b: number,
): Promise<Omit<ScoreRecord, 'scored_at'> | null> {
  if (!rec.scorable || !rec.claim) return null;
  const claim = rec.claim;
  const jd = resolveJudgmentDate(claim, rec.posted_at);
  if (!jd) return null;
  if (jd > todayISO) return null; // not due yet

  const base = {
    tweet_id: rec.tweet_id,
    author_handle: rec.author_handle,
    author_id: rec.author_id,
    judgment_date: jd,
    assets: claim.assets,
    direction: claim.direction,
    price_source: src.name,
  };

  const method = classify(claim, rec.tags);
  if (method === 'review_pending') {
    return { ...base, method, verdict: 'review_pending', detail: { note: 'non-price condition; awaiting LLM-assisted/human review' } };
  }

  const asset = claim.assets[0]!;
  const startDate = rec.posted_at.slice(0, 10);
  const [aStart, aEnd] = await Promise.all([src.getClose(asset, startDate), src.getClose(asset, jd)]);
  if (aStart == null || aEnd == null) {
    return { ...base, method, verdict: 'undetermined', detail: { reason: 'missing_price', asset, startDate, jd } };
  }
  const assetRet = aEnd / aStart - 1;

  let verdict: Verdict;
  const detail: Record<string, unknown> = { asset, startDate, jd, aStart, aEnd, assetRet };
  if (method === 'relative') {
    const bench = benchmarkFor(asset);
    const [bStart, bEnd] = await Promise.all([src.getClose(bench, startDate), src.getClose(bench, jd)]);
    if (bStart == null || bEnd == null) {
      return { ...base, method, verdict: 'undetermined', detail: { ...detail, reason: 'missing_benchmark', bench } };
    }
    const benchRet = bEnd / bStart - 1;
    detail.bench = bench;
    detail.benchRet = benchRet;
    verdict = scoreRelative(claim.direction, assetRet, benchRet, b);
  } else {
    verdict = scoreDirectional(claim.direction, aStart, aEnd, b);
  }
  return { ...base, method, verdict, detail };
}

async function main(): Promise<void> {
  const b = band();
  const todayISO = today();
  const src = makePriceSource(priceConfig().source);
  const claims = readJsonl<ClaimRecord>(CLAIMS_PATH);
  const alreadyScored = existingKeys<ScoreRecord>(SCORES_PATH, (r) => r.tweet_id);

  const scoredAt = new Date().toISOString();
  const fresh: ScoreRecord[] = [];
  for (const rec of claims) {
    if (alreadyScored.has(rec.tweet_id)) continue;
    const res = await scoreOne(rec, src, todayISO, b);
    if (res) fresh.push({ ...res, scored_at: scoredAt });
  }

  const { appended } = appendNew(SCORES_PATH, fresh, (r) => r.tweet_id);

  // Reputation snapshot over ALL score records (append-only, time-stamped).
  const all = readJsonl<ScoreRecord>(SCORES_PATH);
  const authors = aggregateReputation(all);
  mkdirSync(dirname(REPUTATION_PATH), { recursive: true });
  appendFileSync(REPUTATION_PATH, JSON.stringify({ snapshot_at: scoredAt, band: b, authors }) + '\n', 'utf8');

  log('score', 'done', {
    price_source: src.name,
    today: todayISO,
    newly_scored: appended,
    total_scores: all.length,
    authors: authors.length,
  });
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    log('score', 'error: ' + (err as Error).message);
    process.exitCode = 1;
  });
}
