/**
 * Vercel serverless function: GET /claims/active (x402-paid, Solana leg).
 * Thin adapter over the framework-agnostic core in src/x402/handler.ts.
 * verify→settle is delegated to the PayAI facilitator; never a passthrough 200.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defaultDeps, handleActive, readPaymentSignature } from '../../src/x402/handler.js';
import { loadClaims, loadScores } from '../../src/x402/load.js';

function resourceUrl(req: IncomingMessage, path: string): string {
  const host = (req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost') as string;
  const proto = (req.headers['x-forwarded-proto'] ?? 'https') as string;
  return `${proto}://${host}${path}`;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const deps = defaultDeps(loadClaims, loadScores);
    const sig = readPaymentSignature(req.headers);
    const result = await handleActive(deps, resourceUrl(req, '/claims/active'), sig);
    res.statusCode = result.status;
    for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
    res.end(result.body);
  } catch (e) {
    // Last resort: payment-path failures are already 402'd inside handleActive;
    // anything reaching here is a server bug (e.g. data load). Controlled 500
    // with a JSON reason instead of FUNCTION_INVOCATION_FAILED. Never 200.
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'internal_error', message: e instanceof Error ? e.message : String(e) }));
  }
}
