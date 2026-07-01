/**
 * X API bookmarks client. OAuth2 user context (scope bookmark.read), with
 * access-token refresh and pagination. Reads only public metadata plus the
 * body (body is passed to extraction, never persisted here).
 *
 * Scraping is never used; this only calls the official API.
 */
import { xConfig } from '../config/env.js';

const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const API_BASE = 'https://api.x.com/2';

export interface RawBookmark {
  tweet_id: string;
  author_id: string;
  author_handle: string;
  created_at: string;
  /** Transient body for extraction; callers must not persist this. */
  body: string;
}

async function refreshAccessToken(clientId: string, clientSecret: string | undefined, refreshToken: string): Promise<string> {
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
  // Confidential clients authenticate with HTTP Basic; public clients send client_id in the body.
  if (clientSecret) headers['authorization'] = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(TOKEN_URL, { method: 'POST', headers, body: params.toString() });
  if (!res.ok) throw new Error(`token refresh failed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error('token refresh returned no access_token');
  return data.access_token;
}

/**
 * Fetch all bookmarks for the configured user, following pagination.
 * Throws with an explicit message if required env is missing.
 */
export async function* fetchBookmarks(): AsyncGenerator<RawBookmark> {
  const cfg = xConfig();
  if (cfg.missing.length > 0) {
    throw new Error('missing X config: ' + cfg.missing.map((m) => m.name).join(', '));
  }
  const userId = cfg.userId!;
  let accessToken = cfg.accessToken;
  if (!accessToken) {
    accessToken = await refreshAccessToken(cfg.clientId!, cfg.clientSecret, cfg.refreshToken!);
  }

  let nextToken: string | undefined;
  do {
    const url = new URL(`${API_BASE}/users/${userId}/bookmarks`);
    url.searchParams.set('max_results', '100');
    url.searchParams.set('tweet.fields', 'created_at,author_id,text,lang');
    url.searchParams.set('expansions', 'author_id');
    url.searchParams.set('user.fields', 'username');
    if (nextToken) url.searchParams.set('pagination_token', nextToken);

    let res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (res.status === 401 && cfg.refreshToken) {
      // Access token expired mid-run: refresh once and retry.
      accessToken = await refreshAccessToken(cfg.clientId!, cfg.clientSecret, cfg.refreshToken);
      res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    }
    if (!res.ok) throw new Error(`bookmarks fetch ${res.status}: ${await res.text()}`);

    const data = (await res.json()) as {
      data?: Array<{ id: string; author_id: string; created_at: string; text: string }>;
      includes?: { users?: Array<{ id: string; username: string }> };
      meta?: { next_token?: string };
    };
    const handles = new Map((data.includes?.users ?? []).map((u) => [u.id, u.username]));
    for (const t of data.data ?? []) {
      yield {
        tweet_id: t.id,
        author_id: t.author_id,
        author_handle: handles.get(t.author_id) ?? '',
        created_at: t.created_at,
        body: t.text,
      };
    }
    nextToken = data.meta?.next_token;
  } while (nextToken);
}
