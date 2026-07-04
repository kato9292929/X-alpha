/**
 * X OAuth2 refresh tokens ROTATE: each successful refresh returns a new
 * refresh_token and immediately invalidates the old one. If the new value is
 * not written back to the GitHub Actions secret, the next run fails with
 * "Value passed for the token was invalid." (400 invalid_request).
 *
 * This module holds the small, network-free decision logic:
 *   - decide whether a genuinely new token was issued (value changed),
 *   - persist the latest rotated token to a local file (never committed),
 *   - mask secrets for logging.
 * The workflow reads that file and pushes it to the secret via `gh secret set`.
 */
import { writeFileSync } from 'node:fs';

/** Safe-for-logs representation. Never logs the raw secret. */
export function maskToken(t: string | undefined | null): string {
  if (!t) return '(empty)';
  if (t.length <= 8) return `**** (len=${t.length})`;
  return `${t.slice(0, 4)}…${t.slice(-4)} (len=${t.length})`;
}

/** A truly new refresh token: present, a string, and different from the current one. */
export function isRotated(current: string | undefined, received: string | null | undefined): received is string {
  return typeof received === 'string' && received.length > 0 && received !== current;
}

/** File the workflow reads to push the rotated token to the secret. */
export function rotatedTokenPath(): string {
  return process.env.X_REFRESH_TOKEN_OUT ?? '.rotated-refresh-token';
}

/**
 * Write the rotated token to disk with no trailing newline (so `gh secret set
 * ... < file` stores the exact value). Restrictive permissions. Returns path.
 */
export function writeRotatedToken(token: string, path = rotatedTokenPath()): string {
  writeFileSync(path, token, { encoding: 'utf8', mode: 0o600 });
  return path;
}

/**
 * Reconcile a refresh response's refresh_token against the current one.
 * Persists (via the injected side-effect) only when the value actually changed.
 * Pure branch logic — the side effect is injectable so it is unit-testable
 * without touching the network or filesystem.
 */
export function reconcileRefreshToken(params: {
  current: string | undefined;
  received: string | null | undefined;
  persist: (token: string) => void;
}): { next: string | undefined; rotated: boolean } {
  const { current, received, persist } = params;
  if (isRotated(current, received)) {
    persist(received);
    return { next: received, rotated: true };
  }
  return { next: current, rotated: false };
}
