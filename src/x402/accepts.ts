/**
 * Static 402 accepts construction for the Solana leg (§6 form). Built entirely
 * from local config — NEVER from a facilitator getSupported() call at request
 * time, so the 402 is deterministic and always non-empty even if PayAI is down
 * (this reachability-independence is the fix for the OSD 7/1 regression).
 *
 * Transport (§6): requirements go in the PAYMENT-REQUIRED header as base64; the
 * 402 body is `{}` (this is the valid v2 form, NOT an empty 402).
 *
 * accepts includes BOTH a v1 leg (network:"solana") and a v2 leg (CAIP-2),
 * because the current AA rejects a v2-only accepts with
 * "No network/scheme registered for x402 version: 2".
 *
 * The amount FIELD NAME differs by version (same value "10000"):
 *  - v1 leg: `maxAmountRequired` — confirmed against the canonical x402@1.2.0
 *    PaymentRequirementsSchema (maxAmountRequired: z.string().refine(isInteger);
 *    network enum includes "solana"; no top-level `amount`).
 *  - v2 leg: `amount` (top-level) — per the §6 OSD production 402 measurement.
 */
import type { X402Config } from './config.js';

interface LegBase {
  scheme: 'exact';
  network: string;
  asset: string;
  payTo: string;
  extra: { resource: string; feePayer: string };
}
/** v1 uses maxAmountRequired (canonical x402@1.2.0 schema). */
export type V1Requirement = LegBase & { maxAmountRequired: string };
/** v2 uses amount at top level (§6 production measurement). */
export type V2Requirement = LegBase & { amount: string };
export type PaymentRequirement = V1Requirement | V2Requirement;

export interface Requirements {
  x402Version: 2;
  accepts: PaymentRequirement[];
}

function legBase(cfg: X402Config, network: string, resource: string, feePayer: string): LegBase {
  return { scheme: cfg.scheme, network, asset: cfg.asset, payTo: cfg.payTo, extra: { resource, feePayer } };
}

/**
 * v1 leg first (current AA), then v2 leg (future clients). Always length 2 — a
 * missing feePayer does NOT empty accepts. Only feePayer comes from outside
 * (dynamic); everything else is static from config. The two legs differ only in
 * the amount field NAME (maxAmountRequired vs amount); the value is identical.
 */
export function buildAccepts(cfg: X402Config, resource: string, feePayer: string): PaymentRequirement[] {
  const v1: V1Requirement = { ...legBase(cfg, cfg.networkV1, resource, feePayer), maxAmountRequired: cfg.amount };
  const v2: V2Requirement = { ...legBase(cfg, cfg.networkV2, resource, feePayer), amount: cfg.amount };
  return [v1, v2];
}

export function buildRequirements(cfg: X402Config, resource: string, feePayer: string): Requirements {
  return { x402Version: 2, accepts: buildAccepts(cfg, resource, feePayer) };
}

/** base64 of the requirements JSON, for the PAYMENT-REQUIRED header. */
export function encodeRequirementsHeader(requirements: Requirements): string {
  return Buffer.from(JSON.stringify(requirements), 'utf8').toString('base64');
}
