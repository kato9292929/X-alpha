/**
 * X API bookmarks client. OAuth2 user context (scope bookmark.read), with
 * access-token refresh and pagination. Reads only public metadata plus the
 * body (body is passed to extraction, never persisted here).
 *
 * Scraping is never used; this only calls the official API.
 *
 * Refresh tokens ROTATE (see src/lib/tokenStore.ts): every refresh goes through
 * one path here, and when a new refresh token is issued it is persisted so the
 * workflow can write it back to the secret. Without this, the next run fails.
 */
import { xConfig } from '../config/env.js';
import { log } from '../lib/log.js';
import { maskToken, reconcileRefreshToken, writeRotatedToken } from '../lib/tokenStore.js';

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

export interface RefreshResult {
  accessToken: string;
  /** The refresh_token from the response (may be a new, rotated value or null). */
  refreshToken: string | null;
}

async function callTokenRefresh(clientId: string, clientSecret: string | undefined, refreshToken: string): Promise<RefreshResult> {
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
  const data = (await res.json()) as { access_token?: string; refresh_token?: string };
  if (!data.access_token) throw new Error('token refresh returned no access_token');
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? null };
}

/**
 * Holds the live token state for one run. All refreshes go through refresh(),
 * which persists a rotated refresh token (latest value wins) so the workflow can
 * write it back to the secret.
 */
export type RefreshFn = (clientId: string, clientSecret: string | undefined, refreshToken: string) => Promise<RefreshResult>;

export class XTokenManager {
  private accessToken: string | undefined;
  private currentRefresh: string | undefined;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string | undefined,
    initial: { accessToken?: string; refreshToken?: string },
    private readonly onRotate: (token: string) => void = defaultOnRotate,
    // Injectable for tests; defaults to the real network call.
    private readonly refreshFn: RefreshFn = callTokenRefresh,
  ) {
    this.accessToken = initial.accessToken;
    this.currentRefresh = initial.refreshToken;
  }

  /** Return a usable access token, refreshing if we don't have one yet. */
  async getAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;
    return this.refresh();
  }

  /** Force a refresh (e.g. after a 401). Uses the LATEST refresh token. */
  async refresh(): Promise<string> {
    if (!this.currentRefresh) throw new Error('no refresh token available to refresh access token');
    const result = await this.refreshFn(this.clientId, this.clientSecret, this.currentRefresh);
    this.accessToken = result.accessToken;
    // Persist only when the refresh token actually rotated to a new value.
    const { next } = reconcileRefreshToken({
      current: this.currentRefresh,
      received: result.refreshToken,
      persist: this.onRotate,
    });
    this.currentRefresh = next;
    return this.accessToken;
  }
}

/** Default rotation hook: write the latest token to a file and log it masked. */
function defaultOnRotate(token: string): void {
  const path = writeRotatedToken(token);
  log('xClient', `refresh token rotated; latest value written to ${path} for secret write-back ${maskToken(token)}`);
}

/**
 * Fetch all bookmarks for the configured user, following pagination.
 * Throws with an explicit message if required env is missing.
 */
export async function* fetchBookmarks(onRotate?: (token: string) => void): AsyncGenerator<RawBookmark> {
  const cfg = xConfig();
  if (cfg.missing.length > 0) {
    throw new Error('missing X config: ' + cfg.missing.map((m) => m.name).join(', '));
  }
  const userId = cfg.userId!;
  const tokens = new XTokenManager(
    cfg.clientId!,
    cfg.clientSecret,
    { accessToken: cfg.accessToken, refreshToken: cfg.refreshToken },
    onRotate ?? defaultOnRotate,
  );
  let accessToken = await tokens.getAccessToken();

  let nextToken: string | undefined;
  do {
    const url = new URL(`${API_BASE}/users/${userId}/bookmarks`);
    url.searchParams.set('max_results', '100');
    url.searchParams.set('tweet.fields', 'created_at,author_id,text,lang');
    url.searchParams.set('expansions', 'author_id');
    url.searchParams.set('user.fields', 'username');
    if (nextToken) url.searchParams.set('pagination_token', nextToken);

    let res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (res.status === 401) {
      // Access token expired mid-run: refresh (using the latest refresh token) and retry once.
      accessToken = await tokens.refresh();
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
