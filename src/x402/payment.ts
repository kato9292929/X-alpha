/**
 * Payment verify/settle for the Solana leg. The server does NOT sign or settle
 * itself (§1): it hands the PAYMENT-SIGNATURE to the PayAI facilitator and acts
 * on the result. The only self-built thing is the 402 accepts.
 *
 * Wire details of PayAI / @x402/svm could not be confirmed from this sandbox
 * (no network, AA repo out of scope). The Facilitator interface below is the
 * seam: the default HTTP client targets X402_FACILITATOR_URL, and is injectable
 * so the control flow (never passthrough) is unit-tested without the network.
 */
import type { Requirements } from './accepts.js';

export interface Facilitator {
  verify(paymentSignature: string, requirements: Requirements): Promise<{ valid: boolean; reason?: string }>;
  settle(paymentSignature: string, requirements: Requirements): Promise<{ success: boolean; txSignature?: string; reason?: string }>;
}

export interface SettleOutcome {
  ok: boolean;
  /** Goes (base64) into the PAYMENT-RESPONSE header, on success AND failure. */
  response: Record<string, unknown>;
}

/**
 * Verify then settle. Returns ok only when BOTH succeed. On any failure ok=false
 * with a PAYMENT-RESPONSE payload — the caller must NOT return 200 when ok=false.
 */
export async function verifyThenSettle(
  paymentSignature: string,
  requirements: Requirements,
  facilitator: Facilitator,
): Promise<SettleOutcome> {
  const v = await facilitator.verify(paymentSignature, requirements);
  if (!v.valid) {
    return { ok: false, response: { success: false, stage: 'verify', reason: v.reason ?? 'invalid_payment' } };
  }
  const s = await facilitator.settle(paymentSignature, requirements);
  if (!s.success) {
    return { ok: false, response: { success: false, stage: 'settle', reason: s.reason ?? 'settle_failed' } };
  }
  return { ok: true, response: { success: true, txSignature: s.txSignature ?? null } };
}

/** Default facilitator: POSTs to PayAI's verify/settle. Throws if URL unset. */
export function httpFacilitator(baseUrl: string): Facilitator {
  async function call(path: string, body: unknown): Promise<any> {
    if (!baseUrl) throw new Error('X402_FACILITATOR_URL not set; cannot verify/settle (never passing through to 200)');
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`facilitator ${path} ${res.status}: ${await res.text()}`);
    return res.json();
  }
  return {
    async verify(paymentSignature, requirements) {
      return call('/verify', { paymentSignature, requirements });
    },
    async settle(paymentSignature, requirements) {
      return call('/settle', { paymentSignature, requirements });
    },
  };
}
