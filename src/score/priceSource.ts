/**
 * Pluggable price source (Phase 3). getClose returns the closing price on the
 * given date, or the nearest prior trading day. Two adapters:
 *   - StooqSource: free, no API key. https://stooq.com daily CSV.
 *   - FixtureSource: offline, reads data/fixtures/prices.json (used by tests
 *     and by dry-runs when the network blocks live sources).
 */
import { existsSync, readFileSync } from 'node:fs';

export interface PriceSource {
  readonly name: string;
  /** Close on `date` (YYYY-MM-DD) or the nearest earlier trading day; null if unknown. */
  getClose(ticker: string, date: string): Promise<number | null>;
}

/** Pick the value on `date` or the closest earlier date present in the map. */
export function closeOnOrBefore(byDate: Record<string, number>, date: string): number | null {
  if (byDate[date] !== undefined) return byDate[date];
  const earlier = Object.keys(byDate)
    .filter((d) => d <= date)
    .sort();
  const last = earlier.at(-1);
  return last ? byDate[last]! : null;
}

/** Map an internal ticker to a stooq symbol. NVDA -> nvda.us; 7203.T -> 7203.jp */
export function toStooqSymbol(ticker: string): string {
  const t = ticker.trim();
  if (/\.T$/i.test(t)) return t.replace(/\.T$/i, '').toLowerCase() + '.jp';
  if (t.includes('.')) return t.toLowerCase();
  return t.toLowerCase() + '.us';
}

export class StooqSource implements PriceSource {
  readonly name = 'stooq';
  private cache = new Map<string, Record<string, number>>();

  private async history(ticker: string): Promise<Record<string, number>> {
    const sym = toStooqSymbol(ticker);
    const cached = this.cache.get(sym);
    if (cached) return cached;
    const res = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`);
    if (!res.ok) throw new Error(`stooq ${res.status} for ${sym}`);
    const csv = await res.text();
    const byDate: Record<string, number> = {};
    const lines = csv.trim().split('\n');
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i]!.split(',');
      const d = cols[0];
      const close = Number(cols[4]);
      if (d && Number.isFinite(close)) byDate[d] = close;
    }
    this.cache.set(sym, byDate);
    return byDate;
  }

  async getClose(ticker: string, date: string): Promise<number | null> {
    const byDate = await this.history(ticker);
    return closeOnOrBefore(byDate, date);
  }
}

export class FixtureSource implements PriceSource {
  readonly name = 'fixture';
  private data: Record<string, Record<string, number>>;
  constructor(path = 'data/fixtures/prices.json') {
    this.data = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, Record<string, number>>) : {};
  }
  async getClose(ticker: string, date: string): Promise<number | null> {
    const series = this.data[ticker];
    return series ? closeOnOrBefore(series, date) : null;
  }
}

export function makePriceSource(name: string): PriceSource {
  switch (name) {
    case 'fixture':
      return new FixtureSource();
    case 'stooq':
      return new StooqSource();
    default:
      throw new Error(`unknown price source: ${name}`);
  }
}
