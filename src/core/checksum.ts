import { createHash } from "node:crypto";

/* Hashes with node:crypto, for release binaries. The report bundles ./sha256.ts instead, which needs no Node. */

/** The file each release carries next to its binaries, in the format of `sha256sum`: "<hex>  <name>" per line. */
export const SUMS_FILE = "SHA256SUMS";

export function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** The SHA256SUMS text for these files, sorted by name. */
export function formatSums(files: Record<string, Uint8Array>): string {
  return Object.keys(files)
    .sort()
    .map((name) => `${sha256(files[name] as Uint8Array)}  ${name}\n`)
    .join("");
}

/** The hash SHA256SUMS lists for one file, or null when it does not list it. Accepts `*name` (binary mode) too. */
export function expectedSum(sums: string, name: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64}) [ *](.+)$/i.exec(line.trim());
    if (m && m[2] === name) return (m[1] as string).toLowerCase();
  }
  return null;
}
