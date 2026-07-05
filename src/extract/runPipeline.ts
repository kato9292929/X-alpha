/**
 * Phase 2 entrypoint. The falsifiable-record pipeline:
 *   fetch list tweets (body in memory) -> Claude extraction -> falsifiability
 *   filter -> append to claims-history.jsonl (append-only, dedup by tweet_id).
 *
 * The raw tweet body is NEVER persisted: it lives only in the loop variable and
 * is passed to extraction, then discarded. Only the structured, own-words claim
 * is recorded.
 *
 * Run: npm run pipeline
 */
import { fetchListTweets } from '../ingest/xClient.js';
import { latestTweetId } from '../ingest/ingestListTweets.js';
import { extractWithClaude } from './claudeClient.js';
import { evaluateFalsifiability } from './falsifiability.js';
import { appendNew, existingKeys, readJsonl } from '../lib/jsonl.js';
import { log, progress } from '../lib/log.js';
import { xConfig, anthropicConfig } from '../config/env.js';
import { isMain } from '../lib/isMain.js';
import type { ClaimRecord } from './schema.js';

const CLAIMS_PATH = 'data/claims-history.jsonl';

async function main(): Promise<void> {
  const x = xConfig();
  const a = anthropicConfig();
  const missing = [...x.missing, ...a.missing];
  if (missing.length > 0) {
    log('pipeline', 'Cannot run: missing secrets. Set these and re-run:');
    for (const m of missing) log('pipeline', `  - ${m.name}: ${m.why}`);
    process.exitCode = 2;
    return;
  }

  // Dedup against what we already recorded, so we don't re-extract old tweets.
  const existing = readJsonl<ClaimRecord>(CLAIMS_PATH);
  const seen = existingKeys<ClaimRecord>(CLAIMS_PATH, (r) => r.tweet_id);
  const since = latestTweetId(existing);
  const capturedAt = new Date().toISOString();
  const newRecords: ClaimRecord[] = [];

  let processed = 0;
  for await (const b of fetchListTweets(since)) {
    if (seen.has(b.tweet_id)) continue;
    processed++;
    progress('pipeline', `extracting #${processed} tweet ${b.tweet_id} (@${b.author_handle})`);
    const out = await extractWithClaude({ tweet_id: b.tweet_id, author_handle: b.author_handle, body: b.body });
    // Re-derive scorable from the structure ourselves; do not trust the model's flag.
    const f = evaluateFalsifiability(out.claim);
    newRecords.push({
      source: 'x',
      tweet_id: b.tweet_id,
      author_handle: b.author_handle,
      author_id: b.author_id,
      posted_at: b.created_at,
      captured_at: capturedAt,
      scorable: f.scorable,
      claim: out.claim,
      tags: out.tags,
      unscored_reason: f.scorable ? null : (out.unscored_reason ?? f.reason),
    });
    seen.add(b.tweet_id);
  }

  const { appended, skipped } = appendNew(CLAIMS_PATH, newRecords, (r) => r.tweet_id);
  const scorable = newRecords.filter((r) => r.scorable).length;
  log('pipeline', 'done', { new: newRecords.length, appended, skipped, scorable, path: CLAIMS_PATH });
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    log('pipeline', 'error: ' + (err as Error).message);
    process.exitCode = 1;
  });
}
