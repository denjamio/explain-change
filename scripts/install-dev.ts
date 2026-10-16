/**
 * Makes this checkout the `explain-change` on PATH: a shim in ~/.local/bin that runs the source with Bun, and the
 * skills linked to skills/, so every edit shows at once.
 *
 *   bun run install:dev
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { buildAssets } from "./build.ts";

const ROOT = join(import.meta.dir, "..");
const bin = join(homedir(), ".local", "bin");
const entry = join(ROOT, "src/cli/bin.ts");
await buildAssets();
mkdirSync(bin, { recursive: true });
if (process.platform === "win32") {
  rmSync(join(bin, "explain-change.cmd"), { force: true });
  writeFileSync(join(bin, "explain-change.cmd"), `@echo off\r\nbun "${entry}" %*\r\n`);
} else {
  const shim = join(bin, "explain-change");
  rmSync(shim, { force: true }); // an earlier install may be a symlink: never write through it
  writeFileSync(shim, `#!/bin/sh\nexec bun "${entry}" "$@"\n`);
  chmodSync(shim, 0o755);
}
console.log(`shim   ${join(bin, "explain-change")} → ${entry}`);
const p = spawnSync("bun", [entry, "install", "--link", "--force"], { stdio: "inherit" });
if (!(process.env.PATH ?? "").split(delimiter).includes(bin)) console.log(`note: add ${bin} to your PATH`);
process.exit(p.status ?? 1);
