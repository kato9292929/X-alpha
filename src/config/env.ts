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

/** Phase 1 config; returns the list of what is missing so callers can report it. */
export function xConfig(): {
  clientId?: string;
  clientSecret?: string;
  userId?: string;
  refreshToken?: string;
  accessToken?: string;
  missing: MissingEnv[];
} {
  const clientId = req('X_CLIENT_ID');
  const clientSecret = req('X_CLIENT_SECRET');
  const userId = req('X_USER_ID');
  const refreshToken = req('X_REFRESH_TOKEN');
  const accessToken = req('X_ACCESS_TOKEN');

  const missing: MissingEnv[] = [];
  if (!clientId) missing.push({ name: 'X_CLIENT_ID', why: 'X app client id (developer portal).' });
  if (!userId) missing.push({ name: 'X_USER_ID', why: 'numeric user id for GET /2/users/:id/bookmarks.' });
  if (!refreshToken && !accessToken)
    missing.push({
      name: 'X_REFRESH_TOKEN',
      why: 'OAuth2 PKCE refresh token (bookmark.read scope). The consent step must be done once locally; CI cannot complete it.',
    });
  return { clientId, clientSecret, userId, refreshToken, accessToken, missing };
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
