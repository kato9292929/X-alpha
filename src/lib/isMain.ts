import { fileURLToPath } from 'node:url';

/** True when this module is the process entrypoint (not imported by a test). */
export function isMain(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(importMetaUrl) === entry;
  } catch {
    return false;
  }
}
