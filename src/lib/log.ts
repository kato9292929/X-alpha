/** Minimal structured logger. Never logs raw tweet text. */
export function log(scope: string, msg: string, extra?: Record<string, unknown>): void {
  const line = extra ? `${msg} ${JSON.stringify(extra)}` : msg;
  process.stderr.write(`[${scope}] ${line}\n`);
}

/**
 * Progress line to STDOUT (visible in CI live logs). Used to emit per-page /
 * per-item progress so a long run is never silent. Never logs raw tweet text.
 */
export function progress(scope: string, msg: string): void {
  process.stdout.write(`[${scope}] ${msg}\n`);
}
