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

/** The version `npm view` prints: the last one, for a spec that names several. */
export function viewedVersion(stdout: string): string | null {
  const versions = stdout.match(/\d+\.\d+\.\d+(?:-[\w.]+)?/g);
  return versions?.[versions.length - 1] ?? null;
}

/**
 * `update`: `npm install -g explain-change@<the latest>` (or --version), then the new copy refreshes the skills. Only a
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
  // npm keeps a package's versions cached for minutes: right after a release, `latest` would install the one before.
  // The registry itself names the version, and the install asks for exactly that one.
  const asked = npmSpec(opts.version);
  const view = npm(["view", asked, "version", "--prefer-online"], false);
  const target = view.status === 0 ? viewedVersion(view.stdout) : null;
  if (!target) throw new UserError(`npm cannot find ${asked}${view.stderr ? `: ${view.stderr.trim()}` : ""}.`);
  const spec = npmSpec(target);
  if (target !== VERSION) {
    if (!opts.json) console.log(`npm install -g ${spec}`);
    const p = npm(["install", "-g", spec, "--prefer-online"], !opts.json);
    if (p.status !== 0)
      throw new UserError(`\`npm install -g ${spec}\` failed${p.stderr ? `: ${p.stderr.trim()}` : ""}.`);
  }
  // The package's files are new now: run the new copy, so it writes its own skills.
  const check = spawnSync(process.execPath, [path, "--version"], { encoding: "utf8" });
  const version = /explain-change (\S+)/.exec(check.stdout)?.[1] ?? check.stdout.trim();
  if (version !== target) {
    throw new UserError(
      `npm installed ${spec}, but ${path} is still ${version}: another npm prefix may hold it. Run \`npm install -g ${spec}\`, then \`explain-change install\`.`,
    );
  }
  const skills = spawnSync(process.execPath, [path, "install", ...(opts.json ? ["--json"] : [])], {
    encoding: "utf8",
  });
  const refreshed = skills.status === 0 ? "; skills refreshed" : "";
  if (opts.json) printJson({ command: "update", from: VERSION, to: version, path, skills: skills.status === 0 });
  else if (version === VERSION) console.log(`explain-change ${version} is already up to date${refreshed}`);
  else console.log(`updated ${path}: ${VERSION} → ${version}${refreshed}`);
  return 0;
}
