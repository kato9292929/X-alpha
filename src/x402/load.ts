/**
 * Reads the append-only JSONL from the repo at request time. Missing files
 * (e.g. before any pipeline run has committed data) yield [] so the endpoints
 * degrade gracefully (empty meta, null author_weight) instead of erroring.
 */
import { readJsonl } from '../lib/jsonl.js';
import type { ClaimRecord } from '../extract/schema.js';
import type { ScoreRecord } from '../score/reputation.js';

export const CLAIMS_PATH = 'data/claims-history.jsonl';
export const SCORES_PATH = 'data/scores-history.jsonl';

export function loadClaims(): ClaimRecord[] {
  return readJsonl<ClaimRecord>(CLAIMS_PATH);
}

export function loadScores(): ScoreRecord[] {
  return readJsonl<ScoreRecord>(SCORES_PATH);
}
