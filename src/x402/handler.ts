/**
 * Framework-agnostic core for the two endpoints, returning a plain
 * {status, headers, body} so it is fully unit-testable without HTTP. The thin
 * Vercel handlers in api/ adapt this to Node req/res.
 *
 * Payment path hardening (2026-07-09, after the first live pay attempt 500'd):
 *  - PAYMENT-SIGNATURE is base64-DECODED into a PaymentPayload before use
 *    (@x402/core wire: facilitator receives the decoded object).
 *  - The facilitator receives the SINGLE server-built leg matched against the
 *    client's selection — never the whole accepts envelope, never the client's
 *    own accepted terms.
 *  - Every failure on the payment path (decode error, no matching leg, verify
 *    fail, settle fail, thrown fetch errors) returns 402 with PAYMENT-RESPONSE.
 *    handleActive never throws for payment reasons; no more 500s.
 */
import type { ClaimRecord } from '../extract/schema.js';
import type { ScoreRecord } from '../score/reputation.js';
import { x402Config, type X402Config } from './config.js';
import { buildRequirements, encodeRequirementsHeader, type PaymentRequirement, type Requirements } from './accepts.js';
import { buildActivePayload, buildClaimsMeta } from './data.js';
import { verifyThenSettle, httpFacilitator, type Facilitator, type PaymentPayload } from './payment.js';
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
 * GET /claims/active — paid. Without PAYMENT-SIGNATURE: 402 (requirements in
 * the PAYMENT-REQUIRED header, body `{}`). With a signature: decode → match
 * leg → verify→settle via the facilitator; 200 + payload only on success;
 * PAYMENT-RESPONSE on both outcomes. Never a passthrough 200; never throws
 * for payment-path reasons.
 */
export async function handleActive(deps: Deps, resource: string, paymentSignature?: string): Promise<HttpResult> {
  // Only feePayer is dynamic; everything else is static from config.
  const feePayer = await deps.resolveFeePayer();
  const requirements = buildRequirements(deps.cfg, resource, feePayer);

  const paymentRequired = (extra?: Record<string, string>): HttpResult => ({
    status: 402,
    headers: {
      'content-type': 'application/json',
      'PAYMENT-REQUIRED': encodeRequirementsHeader(requirements),
      ...(extra ?? {}),
    },
    body: '{}',
  });

  if (!paymentSignature) return paymentRequired();

  const failResponse = (response: Record<string, unknown>): HttpResult =>
    paymentRequired({ 'PAYMENT-RESPONSE': Buffer.from(JSON.stringify(response), 'utf8').toString('base64') });

  // 1. Decode the payment header (@x402/core: base64 JSON PaymentPayload).
  const payload = decodePaymentSignature(paymentSignature);
  if (!payload) {
    return failResponse({ success: false, stage: 'decode', errorReason: 'invalid_payment_signature_header' });
  }

  // 2. Match the client's selection to OUR server-built leg (never trust the
  //    client's own accepted terms as the requirements sent to the facilitator).
  const matched = matchRequirement(requirements, payload);
  if (!matched) {
    return failResponse({ success: false, stage: 'match', errorReason: 'no_matching_payment_requirements' });
  }

  // 3. verify → settle (never throws; converts all failures to ok=false).
  const outcome = await verifyThenSettle(payload, matched, deps.facilitator);
  const paymentResponse = Buffer.from(JSON.stringify(outcome.response), 'utf8').toString('base64');
  if (!outcome.ok) {
    // Never a passthrough 200: failed verify/settle => 402 with PAYMENT-RESPONSE.
    return paymentRequired({ 'PAYMENT-RESPONSE': paymentResponse });
  }

  const payloadBody = buildActivePayload(deps.loadClaims(), deps.loadScores(), deps.now());
  return {
    status: 200,
    headers: { 'content-type': 'application/json', 'PAYMENT-RESPONSE': paymentResponse },
    body: JSON.stringify(payloadBody),
  };
}

/** base64 → JSON PaymentPayload; null (never throw) on malformed input. */
export function decodePaymentSignature(header: string): PaymentPayload | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as PaymentPayload;
    return null;
  } catch {
    return null;
  }
}

/**
 * Pick the server-built leg the client paid against. v2 payloads carry
 * `accepted` ({scheme, network, ...}); v1 payloads carry scheme/network at the
 * top level. Match by scheme+network against OUR accepts.
 */
export function matchRequirement(requirements: Requirements, payload: PaymentPayload): PaymentRequirement | null {
  const accepted = payload.accepted as Record<string, unknown> | undefined;
  const scheme = (accepted?.scheme ?? payload.scheme) as string | undefined;
  const network = (accepted?.network ?? payload.network) as string | undefined;
  if (!scheme || !network) return null;
  return requirements.accepts.find((leg) => leg.scheme === scheme && leg.network === network) ?? null;
}

/** Read the payment signature header regardless of case. */
export function readPaymentSignature(headers: Record<string, string | string[] | undefined>): string | undefined {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'payment-signature') return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}
