import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

const WINDOWS = process.platform === "win32";

/** The full path of a command on PATH (with PATHEXT on Windows), or null. */
export function which(command: string): string | null {
  const exts = WINDOWS ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, command + ext.toLowerCase());
      if (existsSync(candidate)) return candidate;
      const upper = join(dir, command + ext);
      if (existsSync(upper)) return upper;
    }
  }
  return null;
}

export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs a program found with `which`. Windows runs .cmd/.bat files only through the shell, so there every argument
 * is quoted for cmd.exe.
 */
export function runProgram(
  program: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number },
): RunResult | "timeout" {
  const viaShell = WINDOWS && /\.(cmd|bat)$/i.test(program);
  const quote = (a: string) => `"${a.replace(/"/g, '""')}"`;
  const p = viaShell
    ? spawnSync(quote(program), args.map(quote), { ...spawnOpts(opts), shell: true })
    : spawnSync(program, args, spawnOpts(opts));
  if (p.error && (p.error as NodeJS.ErrnoException).code === "ETIMEDOUT") return "timeout";
  return { status: p.status ?? 1, stdout: String(p.stdout ?? ""), stderr: String(p.stderr ?? "") };
}

function spawnOpts(opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number }) {
  return {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    timeout: opts.timeoutMs,
    encoding: "utf8" as const,
    stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
  };
}
