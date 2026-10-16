import { spawnSync } from "node:child_process";
import { MAX_FILE_BYTES } from "./constants.ts";
import { UserError } from "./errors.ts";

const utf8 = new TextDecoder("utf-8");
const MAX_BUFFER = 1024 * 1024 * 1024;

export interface GitOptions {
  /** Throw a UserError when git fails (default true). */
  check?: boolean;
  input?: string | Uint8Array;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface GitResult {
  status: number;
  stdout: Uint8Array;
  stderr: string;
}

/** Runs git with paths printed raw (no octal quoting). */
export function gitRaw(args: string[], cwd: string, opts: GitOptions = {}): GitResult {
  const p = spawnSync("git", ["-c", "core.quotepath=off", ...args], {
    cwd,
    input: opts.input,
    env: opts.env ?? process.env,
    maxBuffer: MAX_BUFFER,
    timeout: opts.timeoutMs,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (p.error && (p.error as NodeJS.ErrnoException).code === "ENOENT") throw new UserError("git is not installed.");
  if (p.error && (p.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
    throw new UserError(`git ${args.join(" ")} timed out after ${Math.round((opts.timeoutMs ?? 0) / 1000)}s.`);
  }
  const result = { status: p.status ?? 1, stdout: p.stdout ?? new Uint8Array(), stderr: utf8.decode(p.stderr ?? []) };
  if ((opts.check ?? true) && result.status !== 0) {
    throw new UserError(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result;
}

export function git(args: string[], cwd: string, opts: GitOptions = {}): string {
  return utf8.decode(gitRaw(args, cwd, opts).stdout);
}

/** Paths listed by `git ls-files` or `git ls-tree --name-only`, NUL-separated so no name is ever quoted. */
export function gitPaths(args: string[], cwd: string): string[] {
  return git([...args, "-z"], cwd)
    .split("\0")
    .filter(Boolean);
}

/** Decodes file content, or null for binary files (a NUL in the first 8000 bytes) and files over MAX_FILE_BYTES. */
export function decodeText(data: Uint8Array): string | null {
  if (data.length > MAX_FILE_BYTES || data.subarray(0, 8000).includes(0)) return null;
  return utf8.decode(data);
}

/**
 * Text of many files at one revision, through `git cat-file`: their sizes first, then only the blobs small enough
 * to read. A missing path, a binary file or one over MAX_FILE_BYTES maps to null.
 */
export function readBlobs(cwd: string, rev: string, paths: readonly string[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const wanted: { path: string; sha: string }[] = [];
  const check = gitRaw(["cat-file", "--batch-check"], cwd, {
    input: paths.map((p) => `${rev}:${p}\n`).join(""),
  });
  const lines = utf8.decode(check.stdout).split("\n");
  paths.forEach((path, i) => {
    const [sha, type, size] = (lines[i] ?? "").split(" ");
    if (type === "blob" && sha && Number(size) <= MAX_FILE_BYTES) wanted.push({ path, sha });
    else out.set(path, null);
  });
  for (let start = 0; start < wanted.length; start += 2000) {
    const chunk = wanted.slice(start, start + 2000);
    const { stdout } = gitRaw(["cat-file", "--batch"], cwd, { input: chunk.map((w) => `${w.sha}\n`).join("") });
    let pos = 0;
    for (const { path } of chunk) {
      const eol = stdout.indexOf(10, pos);
      const header = utf8.decode(stdout.subarray(pos, eol)).split(" ");
      const size = Number(header[2]);
      if (header.length < 3 || Number.isNaN(size)) {
        out.set(path, null);
        pos = eol + 1;
        continue;
      }
      out.set(path, decodeText(stdout.subarray(eol + 1, eol + 1 + size)));
      pos = eol + 1 + size + 1;
    }
  }
  return out;
}
