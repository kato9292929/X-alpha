/**
 * Payment verify/settle for the Solana leg. The server does NOT sign or settle
 * itself (§1): it hands the decoded payment payload to the PayAI facilitator
 * and acts on the result. The only self-built thing is the 402 accepts.
 *
 * Wire contract (PRIMARY SOURCE: @x402/core 2.17.0 HTTPFacilitatorClient,
 * dist/cjs/http — read via npm pack on 2026-07-09):
 *   POST {facilitator}/verify  body: { x402Version, paymentPayload, paymentRequirements }
 *   POST {facilitator}/settle  body: { x402Version, paymentPayload, paymentRequirements }
 * where paymentPayload is the DECODED PAYMENT-SIGNATURE object (not the raw
 * base64 string) and paymentRequirements is the SINGLE matched leg (not the
 * whole accepts envelope).
 *   verify response: { isValid: boolean, invalidReason?, invalidMessage?, payer? }
 *   settle response: { success: boolean, transaction: string, network, errorReason?, errorMessage?, payer? }
 * The PAYMENT-RESPONSE header is base64(JSON(settle response)).
 *
 * The Facilitator interface below is the injectable seam so the control flow
 * (never passthrough 200) stays unit-testable without the network.
 */
import type { PaymentRequirement } from './accepts.js';

/** Decoded PAYMENT-SIGNATURE payload (v2: { x402Version, accepted, payload }). */
export type PaymentPayload = Record<string, unknown> & { x402Version?: number };

export interface VerifyResult {
  isValid: boolean;
  invalidReason?: string;
  invalidMessage?: string;
  payer?: string;
}

export interface SettleResult {
  success: boolean;
  transaction?: string;
  network?: string;
  errorReason?: string;
  errorMessage?: string;
  payer?: string;
}

export interface Facilitator {
  verify(paymentPayload: PaymentPayload, requirements: PaymentRequirement): Promise<VerifyResult>;
  settle(paymentPayload: PaymentPayload, requirements: PaymentRequirement): Promise<SettleResult>;
}

export interface SettleOutcome {
  ok: boolean;
  /** Goes (base64) into the PAYMENT-RESPONSE header, on success AND failure. */
  response: Record<string, unknown>;
}

/**
 * Verify then settle. Returns ok only when BOTH succeed. On any failure
 * (including thrown errors from the facilitator seam) ok=false with a
 * PAYMENT-RESPONSE payload — the caller must NOT return 200 when ok=false,
 * and this function never throws.
 */
export async function verifyThenSettle(
  paymentPayload: PaymentPayload,
  requirements: PaymentRequirement,
  facilitator: Facilitator,
): Promise<SettleOutcome> {
  let v: VerifyResult;
  try {
    v = await facilitator.verify(paymentPayload, requirements);
  } catch (e) {
    return { ok: false, response: { success: false, stage: 'verify', errorReason: 'verify_error', errorMessage: msg(e) } };
  }
  if (!v.isValid) {
    return {
      ok: false,
      response: { success: false, stage: 'verify', errorReason: v.invalidReason ?? 'invalid_payment', errorMessage: v.invalidMessage },
    };
  }
  let s: SettleResult;
  try {
    s = await facilitator.settle(paymentPayload, requirements);
  } catch (e) {
    return { ok: false, response: { success: false, stage: 'settle', errorReason: 'settle_error', errorMessage: msg(e) } };
  }
  if (!s.success) {
    return {
      ok: false,
      response: { success: false, stage: 'settle', errorReason: s.errorReason ?? 'settle_failed', errorMessage: s.errorMessage, transaction: s.transaction ?? '' },
    };
  }
  // Success: PAYMENT-RESPONSE carries the facilitator settle response
  // (core shape: { success, transaction, network, payer? }).
  return {
    ok: true,
    response: { success: true, transaction: s.transaction ?? '', network: s.network, payer: s.payer },
  };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Default facilitator: POSTs to PayAI's /verify and /settle with the canonical
 * @x402/core wire body. Non-2xx with a parseable protocol body is returned as
 * a failed result; anything else throws (verifyThenSettle converts throws to
 * ok=false, so the HTTP handler never 500s on the payment path).
 */
export function httpFacilitator(baseUrl: string): Facilitator {
  async function call(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
    if (!baseUrl) throw new Error('X402_FACILITATOR_URL not set; cannot verify/settle (never passing through to 200)');
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* non-JSON */ }
    return { status: res.status, json, text };
  }
  function wire(paymentPayload: PaymentPayload, requirements: PaymentRequirement): unknown {
    return {
      x402Version: paymentPayload.x402Version ?? 2,
      paymentPayload,
      paymentRequirements: requirements,
    };
  }
  return {
    async verify(paymentPayload, requirements) {
      const r = await call('/verify', wire(paymentPayload, requirements));
      if (r.json && typeof r.json.isValid === 'boolean') return r.json as unknown as VerifyResult;
      throw new Error(`facilitator /verify ${r.status}: ${r.text.slice(0, 300)}`);
    },
    async settle(paymentPayload, requirements) {
      const r = await call('/settle', wire(paymentPayload, requirements));
      if (r.json && typeof r.json.success === 'boolean') return r.json as unknown as SettleResult;
      throw new Error(`facilitator /settle ${r.status}: ${r.text.slice(0, 300)}`);
    },
  };
}
