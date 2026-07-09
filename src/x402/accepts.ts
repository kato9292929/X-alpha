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
 */
import type { X402Config } from './config.js';

export interface PaymentRequirement {
  scheme: 'exact';
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  extra: { resource: string; feePayer: string };
}

export interface Requirements {
  x402Version: 2;
  accepts: PaymentRequirement[];
}

function leg(cfg: X402Config, network: string, resource: string, feePayer: string): PaymentRequirement {
  return {
    scheme: cfg.scheme,
    network,
    amount: cfg.amount,
    asset: cfg.asset,
    payTo: cfg.payTo,
    extra: { resource, feePayer },
  };
}

/**
 * v1 leg first (current AA), then v2 leg (future clients). Always length 2 — a
 * missing feePayer does NOT empty accepts. Only feePayer comes from outside
 * (dynamic); everything else is static from config.
 */
export function buildAccepts(cfg: X402Config, resource: string, feePayer: string): PaymentRequirement[] {
  return [leg(cfg, cfg.networkV1, resource, feePayer), leg(cfg, cfg.networkV2, resource, feePayer)];
}

export function buildRequirements(cfg: X402Config, resource: string, feePayer: string): Requirements {
  return { x402Version: 2, accepts: buildAccepts(cfg, resource, feePayer) };
}

/** base64 of the requirements JSON, for the PAYMENT-REQUIRED header. */
export function encodeRequirementsHeader(requirements: Requirements): string {
  return Buffer.from(JSON.stringify(requirements), 'utf8').toString('base64');
}
