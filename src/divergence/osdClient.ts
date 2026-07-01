/**
 * Read-only client for osd (onchain-stock-data) public API. We ONLY HTTP GET
 * the published portfolio endpoints and never touch osd's code/data. Holdings
 * in the Claude Portfolio are treated as LONG.
 *
 * The exact JSON shape of the osd response is parsed tolerantly (holdings /
 * positions / array of objects), because this environment cannot reach the live
 * endpoint to confirm it. See README for the confirmation step.
 */
import { existsSync, readFileSync } from 'node:fs';
import { osdConfig } from '../config/env.js';

export interface OsdHolding {
  ticker: string;
  market: 'us' | 'jp';
  side: 'long';
}

/** Pull ticker strings out of an arbitrary osd payload. */
export function extractTickers(payload: unknown, market: 'us' | 'jp'): OsdHolding[] {
  const rows = findRows(payload);
  const out: OsdHolding[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const ticker = pickTicker(row);
    if (ticker && !seen.has(ticker)) {
      seen.add(ticker);
      out.push({ ticker, market, side: 'long' });
    }
  }
  return out;
}

function findRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null);
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>;
    for (const key of ['holdings', 'positions', 'portfolio', 'data', 'items', 'assets']) {
      if (Array.isArray(o[key])) return (o[key] as unknown[]).filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null);
    }
  }
  return [];
}

function pickTicker(row: Record<string, unknown>): string | null {
  for (const key of ['ticker', 'symbol', 'code', 'asset', 'name']) {
    const v = row[key];
    if (typeof v === 'string' && v.trim()) return v.trim().toUpperCase();
  }
  return null;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`osd GET ${res.status} for ${url}`);
  return res.json();
}

/**
 * Load osd holdings for both markets. If X_ALPHA_OSD_SOURCE=fixture, read from
 * data/fixtures/osd_us.json and osd_jp.json instead of the network (for offline
 * dry-runs / tests).
 */
export async function loadOsdHoldings(): Promise<OsdHolding[]> {
  if (process.env.X_ALPHA_OSD_SOURCE === 'fixture') {
    const us = readFixture('data/fixtures/osd_us.json');
    const jp = readFixture('data/fixtures/osd_jp.json');
    return [...extractTickers(us, 'us'), ...extractTickers(jp, 'jp')];
  }
  const { usUrl, jpUrl } = osdConfig();
  const [us, jp] = await Promise.all([getJson(usUrl), getJson(jpUrl)]);
  return [...extractTickers(us, 'us'), ...extractTickers(jp, 'jp')];
}

function readFixture(path: string): unknown {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}
