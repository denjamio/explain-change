import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { VERSION } from "../../core/constants.ts";
import { UserError } from "../../core/errors.ts";
import { printJson } from "../output.ts";

/** How this copy runs: the npm bundle on Node, or a source checkout on Bun (`bun run install:dev`). */
export function installKind(): "npm" | "source" {
  return (globalThis as { Bun?: unknown }).Bun ? "source" : "npm";
}

/** How to remove the CLI itself, once `uninstall` removed the skills. */
export function removeCliHint(kind = installKind()): string {
  if (kind === "source") return "remove the shim in ~/.local/bin (`bun run install:dev` wrote it)";
  return "remove the CLI with `npm uninstall -g explain-change`";
}

/** The npm package spec for a release tag (v0.3.0 → explain-change@0.3.0); no tag: the latest. */
export function npmSpec(version: string | null): string {
  return `explain-change@${version ? version.replace(/^v/, "") : "latest"}`;
}

/** True when `path` lies inside `folder` (another drive on Windows gives an absolute `relative`). */
export function inFolder(path: string, folder: string): boolean {
  const rel = relative(folder, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** npm on PATH: npm.cmd on Windows needs a shell. */
function npm(args: string[], inherit: boolean) {
  return spawnSync("npm", args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: inherit ? ["ignore", "inherit", "inherit"] : "pipe",
  });
}

/**
 * `update`: `npm install -g explain-change@latest` (or --version), then the new copy refreshes the skills. Only a
 * global npm install updates itself; npx, a project dependency or another package manager say how to update instead.
 */
export function update(opts: { version: string | null; json: boolean }): number {
  if (installKind() === "source")
    throw new UserError("This is a source checkout: update it with `git pull`, then `bun run install:dev`.");
  const script = process.argv[1] ?? "";
  const root = npm(["root", "-g"], false);
  const global = root.status === 0 ? root.stdout.trim() : "";
  const path = real(script);
  if (!global || !inFolder(path, real(global))) {
    throw new UserError(
      `This copy is not a global npm install (${script}): update it with the tool that installed it, then run \`explain-change install\`.`,
    );
  }
  const spec = npmSpec(opts.version);
  if (!opts.json) console.log(`npm install -g ${spec}`);
  const p = npm(["install", "-g", spec], !opts.json);
  if (p.status !== 0)
    throw new UserError(`\`npm install -g ${spec}\` failed${p.stderr ? `: ${p.stderr.trim()}` : ""}.`);
  // The package's files are new now: run the new copy, so it writes its own skills.
  const check = spawnSync(process.execPath, [path, "--version"], { encoding: "utf8" });
  const version = /explain-change (\S+)/.exec(check.stdout)?.[1] ?? check.stdout.trim();
  const skills = spawnSync(process.execPath, [path, "install", ...(opts.json ? ["--json"] : [])], {
    encoding: "utf8",
  });
  if (opts.json) printJson({ command: "update", from: VERSION, to: version, path, skills: skills.status === 0 });
  else console.log(`updated ${path}: ${VERSION} → ${version}${skills.status === 0 ? "; skills refreshed" : ""}`);
  return 0;
}
