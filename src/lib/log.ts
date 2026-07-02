/** Minimal structured logger. Never logs raw tweet text. */
export function log(scope: string, msg: string, extra?: Record<string, unknown>): void {
  const line = extra ? `${msg} ${JSON.stringify(extra)}` : msg;
  process.stderr.write(`[${scope}] ${line}\n`);
}
