import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { expectedSum, SUMS_FILE, sha256 } from "../../core/checksum.ts";
import { REPOSITORY, VERSION } from "../../core/constants.ts";
import { UserError } from "../../core/errors.ts";
import { printJson } from "../output.ts";

/** How this copy was installed: a standalone binary can replace itself; npm and source checkouts update their own way. */
export function installKind(): "binary" | "npm" | "source" {
  const bun = (globalThis as { Bun?: { main: string } }).Bun;
  if (bun && /\$bunfs|~BUN/.test(bun.main)) return "binary";
  if (bun) return "source";
  return "npm";
}

/** The release asset for this machine: explain-change-<os>-<arch>[.exe]. */
export function assetName(platform = process.platform, arch = process.arch): string {
  const os = platform === "win32" ? "windows" : platform;
  if (!["linux", "darwin", "windows"].includes(os) || !["x64", "arm64"].includes(arch)) {
    throw new UserError(`No release binary for ${platform}-${arch}. Install with npm: npm install -g explain-change`);
  }
  return `explain-change-${os}-${arch}${os === "windows" ? ".exe" : ""}`;
}

/** Throws unless the release's SHA256SUMS lists this asset with this exact content. */
export function verifyAsset(asset: string, data: Uint8Array, sums: string): void {
  const expected = expectedSum(sums, asset);
  if (!expected) throw new UserError(`The release's ${SUMS_FILE} does not list ${asset}: not installing it.`);
  const actual = sha256(data);
  if (actual !== expected) {
    throw new UserError(
      `The downloaded ${asset} does not match the release's ${SUMS_FILE} (expected ${expected}, got ${actual}): not installing it.`,
    );
  }
}

async function download(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": `explain-change/${VERSION}` } });
  if (!res.ok)
    throw new UserError(`Download failed (${res.status}) from ${url}. Check the version and your connection.`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * `update`: replaces the standalone binary with the latest release (or --version) once its hash matches the release's
 * SHA256SUMS, then refreshes the skills.
 */
export async function update(opts: { version: string | null; json: boolean }): Promise<number> {
  const kind = installKind();
  if (kind === "npm")
    throw new UserError("This copy came from npm: update it with `npm install -g explain-change@latest`.");
  if (kind === "source")
    throw new UserError("This is a source checkout: update it with `git pull`, then `bun run install:dev`.");
  const base = process.env.EXPLAIN_CHANGE_RELEASES ?? `https://github.com/${REPOSITORY}/releases`;
  const dir = opts.version
    ? `${base}/download/${opts.version.startsWith("v") ? opts.version : `v${opts.version}`}`
    : `${base}/latest/download`;
  const asset = assetName();
  const [data, sums] = await Promise.all([download(`${dir}/${asset}`), download(`${dir}/${SUMS_FILE}`)]);
  verifyAsset(asset, data, new TextDecoder().decode(sums));
  const self = process.execPath;
  const next = `${self}.new`;
  writeFileSync(next, data);
  chmodSync(next, 0o755);
  const check = spawnSync(next, ["--version"], { encoding: "utf8" });
  if (check.status !== 0) {
    rmSync(next, { force: true });
    throw new UserError(`The downloaded binary does not run: ${check.stderr.trim() || check.error?.message}`);
  }
  // A running binary cannot be overwritten on Windows, but it can be renamed away.
  const old = `${self}.old`;
  rmSync(old, { force: true });
  renameSync(self, old);
  renameSync(next, self);
  if (process.platform !== "win32" && existsSync(old)) rmSync(old, { force: true });
  const skills = spawnSync(self, ["install", ...(opts.json ? ["--json"] : [])], { encoding: "utf8" });
  const version = /explain-change (\S+)/.exec(check.stdout)?.[1] ?? check.stdout.trim();
  if (opts.json) printJson({ command: "update", from: VERSION, to: version, path: self, skills: skills.status === 0 });
  else console.log(`updated ${self}: ${VERSION} → ${version}${skills.status === 0 ? "; skills refreshed" : ""}`);
  return 0;
}
