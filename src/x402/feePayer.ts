/**
 * feePayer is a DYNAMIC field: PayAI rotates its fee payer (observed
 * D6Zht… → BFK9… → 2wKup…), so freezing it statically makes pay→200 fail after
 * a rotation. We fetch the current feePayer from PayAI /supported, cache it
 * briefly, and fall back to a known value when /supported is unreachable — so an
 * unreachable facilitator never empties accepts (the §6 regression, but on
 * feePayer instead of the whole 402).
 *
 * ONLY feePayer is dynamic. network / amount / asset / payTo / transport stay
 * statically built from config (getSupported-independent).
 *
 * Fallback address: the instruction gives the latest known feePayer only in
 * truncated form ("2wKup…"). A full base58 address is NOT fabricated here — set
 * the real value via X402_FEE_PAYER. If neither /supported nor the env fallback
 * yields a value, feePayer is "" but the two accepts legs are still returned
 * (accepts is never emptied because feePayer is missing).
 */
import type { X402Config } from './config.js';

/** Parsed shape we care about from PayAI /supported (tolerant). */
export type SupportedFetcher = () => Promise<unknown>;

// Rotation history (truncated in the source spec): D6Zht… → BFK9… → 2wKup…
// The real latest value must be provided via X402_FEE_PAYER (no fabrication).
export const KNOWN_FEE_PAYER_HISTORY = ['D6Zht…', 'BFK9…', '2wKup…'] as const;

interface CacheEntry {
  value: string;
  at: number;
}
let cache: CacheEntry | null = null;

/** Test hook: clear the module-level cache. */
export function _resetFeePayerCache(): void {
  cache = null;
}

/** Walk an arbitrary /supported payload and pull the first non-empty feePayer. */
export function extractFeePayer(payload: unknown): string | null {
  let found: string | null = null;
  const visit = (node: unknown): void => {
    if (found || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const el of node) visit(el);
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (found) return;
      if (k === 'feePayer' && typeof v === 'string' && v.length > 0) {
        found = v;
        return;
      }
      visit(v);
    }
  };
  visit(payload);
  return found;
}

/**
 * Resolve the current feePayer: fresh cache → live /supported → fallback.
 * Never throws; on any failure returns the fallback so accepts stays buildable.
 */
export async function resolveFeePayer(
  cfg: X402Config,
  opts?: { fetchSupported?: SupportedFetcher; now?: () => number },
): Promise<string> {
  const now = opts?.now ?? (() => Date.now());
  if (cache && now() - cache.at < cfg.feePayerTtlMs) return cache.value;

  const fetchSupported = opts?.fetchSupported ?? defaultFetchSupported(cfg);
  try {
    const payload = await fetchSupported();
    const live = extractFeePayer(payload);
    if (live) {
      cache = { value: live, at: now() };
      return live;
    }
  } catch {
    // fall through to fallback; do not cache the fallback so recovery is fast.
  }
  return cfg.feePayerFallback; // may be "" — accepts still returns both legs
}

function defaultFetchSupported(cfg: X402Config): SupportedFetcher {
  return async () => {
    if (!cfg.facilitatorUrl) throw new Error('no facilitator url');
    const res = await fetch(`${cfg.facilitatorUrl.replace(/\/$/, '')}/supported`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`/supported ${res.status}`);
    return res.json();
  };
}
