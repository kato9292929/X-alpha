/**
 * Vercel serverless function: GET /claims (free discovery metadata).
 * Thin adapter over the framework-agnostic core in src/x402/handler.ts.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defaultDeps, handleClaims } from '../src/x402/handler.js';
import { loadClaims, loadScores } from '../src/x402/load.js';

function resourceUrl(req: IncomingMessage, path: string): string {
  const host = (req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost') as string;
  const proto = (req.headers['x-forwarded-proto'] ?? 'https') as string;
  return `${proto}://${host}${path}`;
}

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  const deps = defaultDeps(loadClaims, loadScores);
  const result = handleClaims(deps, resourceUrl(req, '/claims'));
  res.statusCode = result.status;
  for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
  res.end(result.body);
}
