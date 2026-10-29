import path from 'node:path';

/**
 * Chloe's local data folder. Source and Windows installs keep `data/` next to
 * the server; the macOS DMG app sets CHLOE_DATA_DIR because its bundle is read-only.
 */
export function dataDirectory(...parts: string[]): string {
  return path.join(process.env.CHLOE_DATA_DIR || path.join(process.cwd(), 'data'), ...parts);
}
