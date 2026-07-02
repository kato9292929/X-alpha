/**
 * Phase 4 entrypoint. Reads osd holdings (read-only), the X claims, and the
 * scores, computes ticker-level divergences, appends a time-stamped snapshot
 * (append-only) and writes a latest view (JSON). No original tweet text is
 * emitted — only own-words summaries.
 *
 * Run: npm run divergence     (X_ALPHA_OSD_SOURCE=fixture for offline dry-run)
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { readJsonl } from '../lib/jsonl.js';
import { loadOsdHoldings } from './osdClient.js';
import { findDivergences } from './divergence.js';
import { log } from '../lib/log.js';
import { isMain } from '../lib/isMain.js';
import type { ClaimRecord } from '../extract/schema.js';
import type { ScoreRecord } from '../score/reputation.js';

const CLAIMS_PATH = 'data/claims-history.jsonl';
const SCORES_PATH = 'data/scores-history.jsonl';
const DIVERGENCE_HISTORY = 'data/divergence-history.jsonl';
const DIVERGENCE_LATEST = 'data/divergence-latest.json';

async function main(): Promise<void> {
  const osd = await loadOsdHoldings();
  const claims = readJsonl<ClaimRecord>(CLAIMS_PATH);
  const scores = readJsonl<ScoreRecord>(SCORES_PATH);

  const items = findDivergences(claims, osd, scores);
  const snapshotAt = new Date().toISOString();
  const snapshot = { snapshot_at: snapshotAt, osd_holdings: osd.length, divergences: items };

  mkdirSync(dirname(DIVERGENCE_HISTORY), { recursive: true });
  appendFileSync(DIVERGENCE_HISTORY, JSON.stringify(snapshot) + '\n', 'utf8');
  writeFileSync(DIVERGENCE_LATEST, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

  log('divergence', 'done', {
    osd_holdings: osd.length,
    divergences: items.length,
    resolved: items.filter((i) => i.resolved).length,
    latest: DIVERGENCE_LATEST,
  });
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    log('divergence', 'error: ' + (err as Error).message);
    process.exitCode = 1;
  });
}
