/**
 * (i) Regression: both served legs MUST validate against the ACTUAL @x402/core
 * PaymentRequirements schemas. This is the guard for the 2026-07-09 live
 * failure where PayAI /verify rejected the leg with invalid_payment_requirements
 * because top-level resource/description/mimeType/maxTimeoutSeconds were missing.
 * Primary source: the schemas exported by @x402/core (a devDependency here),
 * fed the real leg — not a reconstruction. Any future schema gap fails in CI
 * instead of at PayAI verify (i.e. instead of costing a live payment attempt).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { x402Config } from '../src/x402/config.js';
import { buildRequirements } from '../src/x402/accepts.js';

const RESOURCE = 'https://x-alpha-zeta.vercel.app/claims/active';
const FEE_PAYER = '2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4';

test('(i) served v1 + v2 legs pass the real @x402/core PaymentRequirements schemas', async () => {
  const schemas = await import('@x402/core/schemas');
  const reqs = buildRequirements(x402Config(), RESOURCE, FEE_PAYER);
  const v1 = reqs.accepts.find((l) => !l.network.includes(':'))!;
  const v2 = reqs.accepts.find((l) => l.network.includes(':'))!;
  assert.ok(v1, 'v1 leg present');
  assert.ok(v2, 'v2 leg present');

  const r1 = schemas.PaymentRequirementsV1Schema.safeParse(v1);
  assert.ok(r1.success, 'v1 leg must satisfy PaymentRequirementsV1Schema: ' +
    JSON.stringify(r1.success ? [] : r1.error.issues));

  const r2 = schemas.PaymentRequirementsV2Schema.safeParse(v2);
  assert.ok(r2.success, 'v2 leg must satisfy PaymentRequirementsV2Schema: ' +
    JSON.stringify(r2.success ? [] : r2.error.issues));
});

test('(i2) the required top-level fields are actually present on both legs', () => {
  const reqs = buildRequirements(x402Config(), RESOURCE, FEE_PAYER);
  for (const leg of reqs.accepts) {
    for (const f of ['resource', 'description', 'mimeType', 'maxTimeoutSeconds'] as const) {
      assert.ok((leg as unknown as Record<string, unknown>)[f] !== undefined, `${leg.network} leg missing top-level ${f}`);
    }
  }
});
