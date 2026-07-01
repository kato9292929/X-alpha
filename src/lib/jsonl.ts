/**
 * Append-only JSONL store. This is the core discipline of the whole product:
 * records are only ever appended, never rewritten or deleted. Duplicate keys
 * are refused so the same tweet/claim is not recorded twice.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  const out: T[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    out.push(JSON.parse(t) as T);
  }
  return out;
}

/** Set of already-present keys, for dedup. */
export function existingKeys<T>(path: string, keyOf: (r: T) => string): Set<string> {
  return new Set(readJsonl<T>(path).map(keyOf));
}

/**
 * Append records whose key is not already present. Returns how many were
 * appended and how many were skipped as duplicates. Never mutates prior lines.
 */
export function appendNew<T>(path: string, records: T[], keyOf: (r: T) => string): { appended: number; skipped: number } {
  mkdirSync(dirname(path), { recursive: true });
  const seen = existingKeys<T>(path, keyOf);
  let appended = 0;
  let skipped = 0;
  const buf: string[] = [];
  for (const r of records) {
    const k = keyOf(r);
    if (seen.has(k)) {
      skipped++;
      continue;
    }
    seen.add(k);
    buf.push(JSON.stringify(r));
    appended++;
  }
  if (buf.length > 0) appendFileSync(path, buf.join('\n') + '\n', 'utf8');
  return { appended, skipped };
}
