/**
 * X API list-tweets client. Reads the public tweets of an X List via
 * GET /2/lists/:id/tweets using OAuth 2.0 App-Only (Bearer). No user consent,
 * no scopes, no refresh-token rotation. Rate limit is 900/15min per app, far
 * above a once-a-day ingest.
 *
 * Scraping is never used; this only calls the official API. Only public
 * metadata plus the body is read (the body is passed to extraction in memory
 * and never persisted here).
 *
 * Safety limits (learned from a first live run that paged back ~600 reads over
 * 40 min before manual cancel):
 *  - a per-run page cap (X_MAX_PAGES_PER_RUN, default 3 = 300 posts); hitting it
 *    is a normal stop, not an error — later runs catch up via the since-cutoff;
 *  - a 30s timeout per request (no infinite waits);
 *  - a progress line to stdout per page.
 */
import { xConfig, ingestConfig } from '../config/env.js';
import { progress } from '../lib/log.js';

const API_BASE = 'https://api.x.com/2';
const DEFAULT_TIMEOUT_MS = 30_000;

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

export interface FetchListOptions {
  /** Max pages per run. Defaults to X_MAX_PAGES_PER_RUN (or 3). */
  maxPages?: number;
  /** Per-request timeout in ms. Defaults to 30_000. */
  timeoutMs?: number;
}

/**
 * Fetch tweets from the configured list, newest first, following pagination.
 * Stops on the first of: (a) a tweet older-or-equal to `sinceTweetId` (already
 * ingested), or (b) the per-run page cap. Both are normal, non-error stops.
 *
 * `fetchPage` is injectable for tests; it defaults to the real network call.
 * Throws with an explicit message if required env is missing.
 */
export async function* fetchListTweets(
  sinceTweetId?: string,
  fetchPage?: (url: string, bearer: string) => Promise<ListTweetsPage>,
  opts?: FetchListOptions,
): AsyncGenerator<RawTweet> {
  const cfg = xConfig();
  if (cfg.missing.length > 0) {
    throw new Error('missing X config: ' + cfg.missing.map((m) => m.name).join(', '));
  }
  const bearer = cfg.bearerToken!;
  const listId = cfg.listId!;
  const maxPages = opts?.maxPages ?? ingestConfig().maxPagesPerRun;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = fetchPage ?? ((url: string, b: string) => defaultFetchPage(url, b, timeoutMs));

  let nextToken: string | undefined;
  let pageNo = 0;
  do {
    const url = new URL(`${API_BASE}/lists/${listId}/tweets`);
    url.searchParams.set('max_results', '100');
    url.searchParams.set('tweet.fields', 'created_at,author_id');
    url.searchParams.set('expansions', 'author_id');
    url.searchParams.set('user.fields', 'username');
    if (nextToken) url.searchParams.set('pagination_token', nextToken);

    const page = await doFetch(url.toString(), bearer);
    pageNo++;
    const rows = page.data ?? [];
    const oldest = rows.at(-1);
    // Progress: page number, count, and the oldest tweet on this page.
    progress('ingest', `page ${pageNo}: ${rows.length} tweets${oldest ? `, oldest ${oldest.id} @ ${oldest.created_at}` : ' (empty)'}`);

    const handles = new Map((page.includes?.users ?? []).map((u) => [u.id, u.username]));
    for (const t of rows) {
      // Stop at the first already-ingested tweet: the list is newest-first, so
      // everything after this is older and already saved.
      if (sinceTweetId && !tweetIdGt(t.id, sinceTweetId)) {
        progress('ingest', `reached already-ingested tweet ${t.id}; stopping (since-cutoff)`);
        return;
      }
      yield {
        tweet_id: t.id,
        author_id: t.author_id,
        author_handle: handles.get(t.author_id) ?? '',
        created_at: t.created_at,
        body: t.text,
      };
    }

    nextToken = page.meta?.next_token;
    if (nextToken && pageNo >= maxPages) {
      // Normal stop, not an error: cap reached. Remaining older tweets are
      // picked up on the next run via the since-cutoff.
      progress('ingest', `reached max pages (${maxPages}); stopping this run — older tweets will be picked up next run via since-cutoff`);
      return;
    }
  } while (nextToken);
}

async function defaultFetchPage(url: string, bearer: string, timeoutMs: number): Promise<ListTweetsPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${bearer}` }, signal: controller.signal });
    if (!res.ok) {
      // Surface the full status + body so failures are diagnosable, not guessed.
      throw new Error(`list tweets fetch ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as ListTweetsPage;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`list tweets fetch timed out after ${timeoutMs}ms (status unknown)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
