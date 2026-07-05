/**
 * Phase 1 entrypoint. Fetches the configured X List's tweets (App-Only Bearer)
 * and appends minimal raw records (tweet_id, author, timestamps) to an
 * append-only JSONL. The tweet BODY is deliberately not written — it only
 * exists in memory for Phase 2 extraction.
 *
 * Ingestion stops at the newest already-saved tweet_id, so re-runs only read new
 * tweets (dedup + fewer reads under pay-per-use).
 *
 * Run: npm run ingest
 */
import { fetchListTweets } from './xClient.js';
import { appendNew, readJsonl } from '../lib/jsonl.js';
import { log } from '../lib/log.js';
import { isMain } from '../lib/isMain.js';
import { xConfig } from '../config/env.js';
import type { IngestedTweetRaw } from '../extract/schema.js';

const RAW_PATH = 'data/tweets-raw.jsonl';

/** Newest tweet_id already saved (max by numeric id), or undefined if none. */
export function latestTweetId(records: Array<{ tweet_id: string }>): string | undefined {
  let max: bigint | undefined;
  let maxStr: string | undefined;
  for (const r of records) {
    const v = BigInt(r.tweet_id);
    if (max === undefined || v > max) {
      max = v;
      maxStr = r.tweet_id;
    }
  }
  return maxStr;
}

async function main(): Promise<void> {
  const cfg = xConfig();
  if (cfg.missing.length > 0) {
    log('ingest', 'Cannot run: missing secrets. Set these and re-run:');
    for (const m of cfg.missing) log('ingest', `  - ${m.name}: ${m.why}`);
    process.exitCode = 2;
    return;
  }

  const since = latestTweetId(readJsonl<IngestedTweetRaw>(RAW_PATH));
  const records: IngestedTweetRaw[] = [];
  const capturedAt = new Date().toISOString();
  let count = 0;
  for await (const t of fetchListTweets(since)) {
    count++;
    records.push({
      source: 'x',
      tweet_id: t.tweet_id,
      author_handle: t.author_handle,
      author_id: t.author_id,
      created_at: t.created_at,
      captured_at: capturedAt,
    });
  }

  const { appended, skipped } = appendNew(RAW_PATH, records, (r) => r.tweet_id);
  log('ingest', 'done', { since: since ?? '(none)', fetched: count, appended, skipped, path: RAW_PATH });
  // Note: bodies were held only in memory and are now discarded.
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    log('ingest', 'error: ' + (err as Error).message);
    process.exitCode = 1;
  });
}
