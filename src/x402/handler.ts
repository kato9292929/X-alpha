/**
 * Framework-agnostic core for the two endpoints, returning a plain
 * {status, headers, body} so it is fully unit-testable without HTTP. The thin
 * Vercel handlers in api/ adapt this to Node req/res.
 */
import type { ClaimRecord } from '../extract/schema.js';
import type { ScoreRecord } from '../score/reputation.js';
import { x402Config, type X402Config } from './config.js';
import { buildRequirements, encodeRequirementsHeader } from './accepts.js';
import { buildActivePayload, buildClaimsMeta } from './data.js';
import { verifyThenSettle, httpFacilitator, type Facilitator } from './payment.js';
import { resolveFeePayer } from './feePayer.js';

export interface HttpResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface Deps {
  cfg: X402Config;
  loadClaims: () => ClaimRecord[];
  loadScores: () => ScoreRecord[];
  now: () => string;
  facilitator: Facilitator;
  /** Dynamic feePayer resolution (PayAI /supported → cache → fallback). */
  resolveFeePayer: () => Promise<string>;
}

export function defaultDeps(loadClaims: () => ClaimRecord[], loadScores: () => ScoreRecord[]): Deps {
  const cfg = x402Config();
  return {
    cfg,
    loadClaims,
    loadScores,
    now: () => new Date().toISOString(),
    facilitator: httpFacilitator(cfg.facilitatorUrl),
    resolveFeePayer: () => resolveFeePayer(cfg),
  };
}

/** GET /claims — free discovery metadata (no bodies, no 402). */
export function handleClaims(deps: Deps, resource: string): HttpResult {
  const meta = buildClaimsMeta(deps.loadClaims(), deps.now());
  const body = {
    ...meta,
    _hint: {
      paid_path: '/claims/active',
      price_atomic: deps.cfg.amount,
      price_note: `${deps.cfg.amount} atomic USDC (6 decimals)`,
      pay_to: deps.cfg.payTo,
      network: deps.cfg.networkV2,
      asset: deps.cfg.asset,
      protocol: 'x402',
      how: 'call /claims/active; on 402 read PAYMENT-REQUIRED (base64 requirements) and pay via an x402 client',
    },
  };
  return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

/**
 * GET /claims/active — paid. Without PAYMENT-SIGNATURE: 402 (requirements in the
 * PAYMENT-REQUIRED header, body `{}`). With a signature: verify→settle via the
 * facilitator; 200 + payload only on success; PAYMENT-RESPONSE on both outcomes.
 */
export async function handleActive(deps: Deps, resource: string, paymentSignature?: string): Promise<HttpResult> {
  // Only feePayer is dynamic; everything else is static from config.
  const feePayer = await deps.resolveFeePayer();
  const requirements = buildRequirements(deps.cfg, resource, feePayer);

  if (!paymentSignature) {
    return {
      status: 402,
      headers: {
        'content-type': 'application/json',
        'PAYMENT-REQUIRED': encodeRequirementsHeader(requirements),
      },
      body: '{}',
    };
  }

  const outcome = await verifyThenSettle(paymentSignature, requirements, deps.facilitator);
  const paymentResponse = Buffer.from(JSON.stringify(outcome.response), 'utf8').toString('base64');
  if (!outcome.ok) {
    // Never a passthrough 200: failed verify/settle => 402 with PAYMENT-RESPONSE.
    return {
      status: 402,
      headers: {
        'content-type': 'application/json',
        'PAYMENT-REQUIRED': encodeRequirementsHeader(requirements),
        'PAYMENT-RESPONSE': paymentResponse,
      },
      body: '{}',
    };
  }

  const payload = buildActivePayload(deps.loadClaims(), deps.loadScores(), deps.now());
  return {
    status: 200,
    headers: { 'content-type': 'application/json', 'PAYMENT-RESPONSE': paymentResponse },
    body: JSON.stringify(payload),
  };
}

/** Read the payment signature header regardless of case. */
export function readPaymentSignature(headers: Record<string, string | string[] | undefined>): string | undefined {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'payment-signature') return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}
