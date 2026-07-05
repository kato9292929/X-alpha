/**
 * X API list-tweets client. Reads the public tweets of an X List via
 * GET /2/lists/:id/tweets using OAuth 2.0 App-Only (Bearer). No user consent,
 * no scopes, no refresh-token rotation. Rate limit is 900/15min per app, far
 * above a once-a-day ingest.
 *
 * Scraping is never used; this only calls the official API. Only public
 * metadata plus the body is read (the body is passed to extraction in memory
 * and never persisted here).
 */
import { xConfig } from '../config/env.js';

const API_BASE = 'https://api.x.com/2';

export interface RawTweet {
  tweet_id: string;
  author_id: string;
  author_handle: string;
  created_at: string;
  /** Transient body for extraction; callers must not persist this. */
  body: string;
}

/** Compare two numeric tweet-id strings (snowflake ids are monotonically increasing). */
export function tweetIdGt(a: string, b: string): boolean {
  return BigInt(a) > BigInt(b);
}

interface ListTweetsPage {
  data?: Array<{ id: string; author_id: string; created_at: string; text: string }>;
  includes?: { users?: Array<{ id: string; username: string }> };
  meta?: { next_token?: string };
}

/**
 * Fetch tweets from the configured list, newest first, following pagination.
 * Stops as soon as a tweet older-or-equal to `sinceTweetId` is reached (already
 * ingested) — this prevents duplicate saves and saves reads under pay-per-use.
 *
 * `fetchPage` is injectable for tests; it defaults to the real network call.
 * Throws with an explicit message if required env is missing.
 */
export async function* fetchListTweets(
  sinceTweetId?: string,
  fetchPage: (url: string, bearer: string) => Promise<ListTweetsPage> = defaultFetchPage,
): AsyncGenerator<RawTweet> {
  const cfg = xConfig();
  if (cfg.missing.length > 0) {
    throw new Error('missing X config: ' + cfg.missing.map((m) => m.name).join(', '));
  }
  const bearer = cfg.bearerToken!;
  const listId = cfg.listId!;

  let nextToken: string | undefined;
  do {
    const url = new URL(`${API_BASE}/lists/${listId}/tweets`);
    url.searchParams.set('max_results', '100');
    url.searchParams.set('tweet.fields', 'created_at,author_id');
    url.searchParams.set('expansions', 'author_id');
    url.searchParams.set('user.fields', 'username');
    if (nextToken) url.searchParams.set('pagination_token', nextToken);

    const page = await fetchPage(url.toString(), bearer);
    const handles = new Map((page.includes?.users ?? []).map((u) => [u.id, u.username]));

    for (const t of page.data ?? []) {
      // Stop at the first already-ingested tweet: the list is newest-first, so
      // everything after this is older and already saved.
      if (sinceTweetId && !tweetIdGt(t.id, sinceTweetId)) return;
      yield {
        tweet_id: t.id,
        author_id: t.author_id,
        author_handle: handles.get(t.author_id) ?? '',
        created_at: t.created_at,
        body: t.text,
      };
    }
    nextToken = page.meta?.next_token;
  } while (nextToken);
}

async function defaultFetchPage(url: string, bearer: string): Promise<ListTweetsPage> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${bearer}` } });
  if (!res.ok) {
    // Surface the full status + body so failures are diagnosable, not guessed.
    throw new Error(`list tweets fetch ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as ListTweetsPage;
}
