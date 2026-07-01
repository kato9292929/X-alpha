/**
 * Phase 1 entrypoint. Fetches bookmarks and appends minimal raw records
 * (tweet_id, author, timestamps) to an append-only JSONL. The tweet BODY is
 * deliberately not written — it only exists in memory for Phase 2 extraction.
 *
 * Run: npm run ingest
 */
import { fetchBookmarks } from './xClient.js';
import { appendNew } from '../lib/jsonl.js';
import { log } from '../lib/log.js';
import { xConfig } from '../config/env.js';
import type { BookmarkRaw } from '../extract/schema.js';

const RAW_PATH = 'data/bookmarks-raw.jsonl';

async function main(): Promise<void> {
  const cfg = xConfig();
  if (cfg.missing.length > 0) {
    log('ingest', 'Cannot run: missing secrets. Set these and re-run:');
    for (const m of cfg.missing) log('ingest', `  - ${m.name}: ${m.why}`);
    process.exitCode = 2;
    return;
  }

  const records: BookmarkRaw[] = [];
  const capturedAt = new Date().toISOString();
  let count = 0;
  for await (const b of fetchBookmarks()) {
    count++;
    records.push({
      source: 'x',
      tweet_id: b.tweet_id,
      author_handle: b.author_handle,
      author_id: b.author_id,
      created_at: b.created_at,
      captured_at: capturedAt,
    });
  }

  const { appended, skipped } = appendNew(RAW_PATH, records, (r) => r.tweet_id);
  log('ingest', 'done', { fetched: count, appended, skipped, path: RAW_PATH });
  // Note: bodies were held only in memory and are now discarded.
}

main().catch((err) => {
  log('ingest', 'error: ' + (err as Error).message);
  process.exitCode = 1;
});
