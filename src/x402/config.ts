/**
 * x402 payment config for the Solana leg. Defaults are the §6 (2026-07-08)
 * measured-402 values from the internal standard; every value is env-overridable
 * so nothing sensitive is frozen in code.
 *
 * NOTE (honest, unverified): these defaults are taken from the instruction's
 * §6 measurement. This sandbox cannot reach OSD /api/ipo, PayAI, or the AA repo,
 * so they are NOT independently verified here. registerExactSvmScheme's exact
 * network string could not be confirmed against the AA repo (out of session
 * scope) and is treated as §6-authoritative.
 *
 * feePayer is NOT static (PayAI rotates it): it is fetched from PayAI /supported
 * at request time with a short cache and a fallback (see feePayer.ts). The value
 * here (X402_FEE_PAYER) is only the FALLBACK override used when /supported is
 * unreachable.
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
  /** FALLBACK PayAI fee payer (override) used only when /supported is unreachable. */
  feePayerFallback: string;
  /** PayAI facilitator base URL for /supported + verify/settle. Empty disables live calls. */
  facilitatorUrl: string;
  /** How long a fetched feePayer is cached (ms). */
  feePayerTtlMs: number;
  /** Canonical value (§6): 300. Facilitator settle-window; on every accepts leg. */
  maxTimeoutSeconds: number;
  /** Human description on each accepts leg (required by the canonical schema). */
  description: string;
  /** MIME type of the paid payload (required by the canonical schema). */
  mimeType: string;
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
    feePayerFallback: env('X402_FEE_PAYER', ''),
    facilitatorUrl: env('X402_FACILITATOR_URL', ''),
    feePayerTtlMs: Number(env('X402_FEE_PAYER_TTL_MS', '300000')),
    maxTimeoutSeconds: Number(env('X402_MAX_TIMEOUT_SECONDS', '300')),
    description: env('X402_DESCRIPTION', 'X-alpha active scorable claims with author track record'),
    mimeType: env('X402_MIME_TYPE', 'application/json'),
  };
}
