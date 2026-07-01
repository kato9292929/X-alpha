/**
 * Claude extraction call. Takes the raw tweet body ONLY as transient input and
 * asks Claude to return a structured claim in its own words. The raw body is
 * never returned or persisted by this module.
 */
import { anthropicConfig } from '../config/env.js';
import type { Claim, Direction } from './schema.js';

export interface ExtractionInput {
  tweet_id: string;
  author_handle: string;
  /** Transient: used to build the prompt, never stored. */
  body: string;
  lang?: string;
}

export interface ExtractionOutput {
  claim: Claim | null;
  tags: string[];
  unscored_reason: string | null;
}

const SYSTEM = `You convert a single X (Twitter) post about markets into a structured, falsifiable investment claim.
Hard rules:
- Do NOT reproduce or quote the post. "thesis" and "condition" must be YOUR OWN concise paraphrase.
- Stay neutral about the author. No praise, blame, or judgement language.
- Only fill "claim" when the post makes a checkable market prediction. Otherwise set claim=null.
- direction must be one of: up, down, long, short, outperform, underperform, neutral, unknown.
- assets must be resolvable tickers when possible (e.g. NVDA, 7203.T). If only a theme is named, put the theme string and add tag "theme_only".
- judgment_date: an explicit ISO date (YYYY-MM-DD) if the post states one, else null.
- horizon: a short window string (e.g. "3m", "by FY2026") if implied, else null.
- Add tag "fundamental" or "complex_condition" when the condition depends on non-price data (earnings, backlog, guidance, etc.).
Return ONLY JSON matching:
{"claim": {"assets": string[], "direction": string, "thesis": string, "condition": string, "judgment_date": string|null, "horizon": string|null} | null, "tags": string[], "unscored_reason": string|null}`;

function coerceDirection(d: unknown): Direction {
  const s = String(d ?? '').toLowerCase().trim();
  const allowed: Direction[] = ['up', 'down', 'long', 'short', 'outperform', 'underperform', 'neutral', 'unknown'];
  return (allowed as string[]).includes(s) ? (s as Direction) : 'unknown';
}

function coerceOutput(obj: unknown): ExtractionOutput {
  const o = (obj ?? {}) as Record<string, unknown>;
  const rawClaim = o.claim as Record<string, unknown> | null | undefined;
  let claim: Claim | null = null;
  if (rawClaim && typeof rawClaim === 'object') {
    claim = {
      assets: Array.isArray(rawClaim.assets) ? rawClaim.assets.map((a) => String(a)) : [],
      direction: coerceDirection(rawClaim.direction),
      thesis: String(rawClaim.thesis ?? ''),
      condition: String(rawClaim.condition ?? ''),
      judgment_date: rawClaim.judgment_date ? String(rawClaim.judgment_date) : null,
      horizon: rawClaim.horizon ? String(rawClaim.horizon) : null,
    };
  }
  return {
    claim,
    tags: Array.isArray(o.tags) ? o.tags.map((t) => String(t)) : [],
    unscored_reason: o.unscored_reason ? String(o.unscored_reason) : null,
  };
}

/** Pull the first JSON object out of a model text response. */
export function parseModelJson(text: string): ExtractionOutput {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return { claim: null, tags: ['parse_error'], unscored_reason: 'model_no_json' };
  const obj = JSON.parse(text.slice(start, end + 1));
  return coerceOutput(obj);
}

/** Calls the Anthropic Messages API. Throws if ANTHROPIC_API_KEY is absent. */
export async function extractWithClaude(input: ExtractionInput): Promise<ExtractionOutput> {
  const { apiKey, model } = anthropicConfig();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set; cannot run extraction.');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: 'user', content: `POST BODY (transient, do not quote back):\n${input.body}` }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  return parseModelJson(text);
}
