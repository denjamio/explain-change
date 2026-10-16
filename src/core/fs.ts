import { existsSync, mkdirSync } from "node:fs";

/**
 * Creates a folder and its parents when missing. Never asks mkdir to create a folder that exists: Bun on Windows
 * throws EEXIST for some existing paths (".", 8.3 short names) even with { recursive: true }.
 */
export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
