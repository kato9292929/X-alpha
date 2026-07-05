/**
 * Central env/secret access. Nothing secret is hard-coded; every value is read
 * from process.env. Each getter documents what to set when it is missing.
 */

export interface MissingEnv {
  name: string;
  why: string;
}

function req(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

/**
 * Phase 1 config. Ingestion reads a public X List's tweets via GET
 * /2/lists/:id/tweets, which supports OAuth 2.0 App-Only (Bearer). No user
 * consent, no refresh tokens, no rotation. Returns what is missing so callers
 * can report it.
 */
export function xConfig(): {
  bearerToken?: string;
  listId?: string;
  missing: MissingEnv[];
} {
  const bearerToken = req('X_BEARER_TOKEN');
  const listId = req('X_LIST_ID');

  const missing: MissingEnv[] = [];
  if (!bearerToken)
    missing.push({ name: 'X_BEARER_TOKEN', why: 'X App-Only Bearer token (Developer Console > Keys and Tokens). No scope/consent needed.' });
  if (!listId) missing.push({ name: 'X_LIST_ID', why: 'numeric id of the public X List to ingest (the number at the end of the list URL).' });
  return { bearerToken, listId, missing };
}

/**
 * Phase 1 ingest limits. A single run reads at most maxPagesPerRun pages
 * (100 tweets each). This bounds reads/time on the first run when there is no
 * since-cutoff yet; later runs pick up the rest via the since-cutoff.
 */
export function ingestConfig(): { maxPagesPerRun: number } {
  const p = Number(process.env.X_MAX_PAGES_PER_RUN);
  return { maxPagesPerRun: Number.isFinite(p) && p > 0 ? Math.floor(p) : 3 };
}

/** Phase 2 config. */
export function anthropicConfig(): { apiKey?: string; model: string; missing: MissingEnv[] } {
  const apiKey = req('ANTHROPIC_API_KEY');
  // Kept in sync with osd. Override via X_ALPHA_ANTHROPIC_MODEL.
  const model = req('X_ALPHA_ANTHROPIC_MODEL') ?? 'claude-sonnet-5';
  const missing: MissingEnv[] = [];
  if (!apiKey) missing.push({ name: 'ANTHROPIC_API_KEY', why: 'Anthropic API key (same family as osd) for claim extraction.' });
  return { apiKey, model, missing };
}

/** Phase 3 config. */
export function priceConfig(): { source: string } {
  return { source: req('X_ALPHA_PRICE_SOURCE') ?? 'stooq' };
}

/** Phase 4 config (read-only osd endpoints). */
export function osdConfig(): { usUrl: string; jpUrl: string } {
  return {
    usUrl: req('OSD_US_PORTFOLIO_URL') ?? 'https://osd-coral.vercel.app/api/alpha/portfolio/current',
    jpUrl: req('OSD_JP_PORTFOLIO_URL') ?? 'https://osd-coral.vercel.app/api/alpha/jp/portfolio/current',
  };
}
