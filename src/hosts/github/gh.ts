import { GH_TIMEOUT_MS } from "../../core/constants.ts";
import { type RunResult, runProgram, which } from "../../core/proc.ts";

export const GH_SETUP = "install the gh CLI, then `gh auth login`";

/** A gh call's result, or why it could not run. */
export type GhResult = RunResult | { error: string };

/** The gh CLI. Tests replace `call`. It never logs in on its own: `gh auth login` asks questions in the terminal. */
export class Gh {
  call(args: string[], cwd: string): GhResult {
    const gh = which("gh");
    if (!gh) return { error: "gh CLI not found" };
    const r = runProgram(gh, args, { cwd, env: { ...process.env, GH_PROMPT_DISABLED: "1" }, timeoutMs: GH_TIMEOUT_MS });
    return r === "timeout" ? { error: `gh timed out after ${GH_TIMEOUT_MS / 1000}s` } : r;
  }
}

/** gh's error, with the fix for the usual causes. */
export function ghHint(stderr: string): string {
  const low = stderr.toLowerCase();
  if (low.includes("gh auth login") || low.includes("not logged") || low.includes("authentication"))
    return "not logged in: run `gh auth login`";
  if (low.includes("none of the git remotes") || low.includes("no git remotes"))
    return "gh cannot tell the repository from the git remotes: pass the PR URL";
  if (low.includes("could not resolve to a pullrequest") || low.includes("no pull requests found"))
    return "no such PR in this repository";
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines[0]?.slice(0, 200) ?? "unknown error";
}
