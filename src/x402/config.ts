/**
 * x402 payment config for the Solana leg. Defaults are the §6 (2026-07-08)
 * measured-402 values from the internal standard; every value is env-overridable
 * so nothing sensitive is frozen in code.
 *
 * NOTE (honest, unverified): these defaults are taken from the instruction's
 * §6 measurement. This sandbox cannot reach OSD /api/ipo, PayAI, or the AA repo,
 * so they are NOT independently verified here. feePayer has NO safe default (it
 * is PayAI's fee-payer address) — it must be supplied via env before a live
 * pay→200. registerExactSvmScheme's exact network string could not be confirmed
 * against the AA repo (out of session scope) and is treated as §6-authoritative.
 */
export interface X402Config {
  scheme: 'exact';
  /** v1 leg network (current AA rejects a v2-only accepts). */
  networkV1: string;
  /** v2 CAIP-2 network. */
  networkV2: string;
  /** Atomic units integer string (USDC 6 decimals). $0.01 = "10000". */
  amount: string;
  /** Solana mainnet USDC mint. */
  asset: string;
  /** X-alpha receiving wallet. */
  payTo: string;
  /** PayAI fee payer. Empty until provided (see note above). */
  feePayer: string;
  /** PayAI facilitator base URL for verify/settle. Empty disables live settle. */
  facilitatorUrl: string;
  maxTimeoutSeconds: number;
}

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

export function x402Config(): X402Config {
  return {
    scheme: 'exact',
    networkV1: env('X402_NETWORK_V1', 'solana'),
    networkV2: env('X402_NETWORK_V2', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'),
    amount: env('X402_AMOUNT', '10000'),
    asset: env('X402_ASSET', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    payTo: env('X402_PAY_TO', '4s8XQC2WzRfgH8Xiep7ybnCW11VKRCMwxQF6jknx3VPf'),
    feePayer: env('X402_FEE_PAYER', ''),
    facilitatorUrl: env('X402_FACILITATOR_URL', ''),
    maxTimeoutSeconds: Number(env('X402_MAX_TIMEOUT_SECONDS', '60')),
  };
}
